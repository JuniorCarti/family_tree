const crypto = require('crypto');
const express = require('express');
const db = require('./db');

const ROLE_LEVEL = Object.freeze({ viewer: 1, contributor: 2, admin: 3, owner: 4 });
const INVITABLE_ROLES = new Set(['viewer', 'contributor', 'admin']);

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function maskEmail(email) {
  const [local, domain] = normalizeEmail(email).split('@');
  if (!domain) return '';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(2, local.length - visible.length))}@${domain}`;
}

async function initializeFamilySharing() {
  await db.ready;
  const client = await db.pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('lineage_family_sharing_v1'))");
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS families (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS family_memberships (
        family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL CHECK (role IN ('viewer', 'contributor', 'admin', 'owner')),
        joined_at TIMESTAMP NOT NULL DEFAULT now(),
        PRIMARY KEY (family_id, user_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS family_invitations (
        id SERIAL PRIMARY KEY,
        family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('viewer', 'contributor', 'admin')),
        token_hash CHAR(64) NOT NULL UNIQUE,
        invited_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMP NOT NULL,
        accepted_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await client.query('ALTER TABLE persons ADD COLUMN IF NOT EXISTS family_id INTEGER REFERENCES families(id) ON DELETE CASCADE');
    await client.query('ALTER TABLE persons ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
    await client.query('ALTER TABLE relationships ADD COLUMN IF NOT EXISTS family_id INTEGER REFERENCES families(id) ON DELETE CASCADE');
    await client.query('ALTER TABLE relationships ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');

    await client.query(`
      INSERT INTO families (name, owner_user_id)
      SELECT COALESCE(NULLIF(trim(u.family_name), ''), 'My Family Tree'), u.id
      FROM users u
      WHERE NOT EXISTS (
        SELECT 1 FROM family_memberships fm WHERE fm.user_id = u.id
      )
    `);

    await client.query(`
      INSERT INTO family_memberships (family_id, user_id, role)
      SELECT f.id, f.owner_user_id, 'owner'
      FROM families f
      ON CONFLICT (family_id, user_id) DO UPDATE SET role = 'owner'
    `);

    await client.query(`
      UPDATE persons p
      SET family_id = f.id, created_by_user_id = COALESCE(p.created_by_user_id, p.user_id)
      FROM families f
      WHERE p.family_id IS NULL
        AND f.owner_user_id = p.user_id
        AND f.id = (SELECT MIN(f2.id) FROM families f2 WHERE f2.owner_user_id = p.user_id)
    `);

    await client.query(`
      UPDATE relationships r
      SET family_id = f.id, created_by_user_id = COALESCE(r.created_by_user_id, r.user_id)
      FROM families f
      WHERE r.family_id IS NULL
        AND f.owner_user_id = r.user_id
        AND f.id = (SELECT MIN(f2.id) FROM families f2 WHERE f2.owner_user_id = r.user_id)
    `);

    await client.query('ALTER TABLE persons ALTER COLUMN family_id SET NOT NULL');
    await client.query('ALTER TABLE relationships ALTER COLUMN family_id SET NOT NULL');
    await client.query('ALTER TABLE persons ALTER COLUMN user_id DROP NOT NULL');
    await client.query('ALTER TABLE relationships ALTER COLUMN user_id DROP NOT NULL');
    await client.query('ALTER TABLE persons DROP CONSTRAINT IF EXISTS persons_user_id_fkey');
    await client.query('ALTER TABLE persons ADD CONSTRAINT persons_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL NOT VALID');
    await client.query('ALTER TABLE relationships DROP CONSTRAINT IF EXISTS relationships_user_id_fkey');
    await client.query('ALTER TABLE relationships ADD CONSTRAINT relationships_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL NOT VALID');

    await client.query('CREATE INDEX IF NOT EXISTS idx_persons_family ON persons(family_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_relationships_family ON relationships(family_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_memberships_user ON family_memberships(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_invitations_family ON family_invitations(family_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_invitations_email ON family_invitations(lower(email))');

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('lineage_family_sharing_v1'))").catch(() => {});
    client.release();
  }
}

const ready = initializeFamilySharing().catch((error) => {
  console.error('Family sharing schema initialization failed:', error);
  throw error;
});

async function listFamilies(userId, client = db) {
  await ready;
  const result = await client.query(`
    SELECT f.id, f.name, f.owner_user_id, fm.role, fm.joined_at,
           (SELECT count(*)::int FROM family_memberships members WHERE members.family_id = f.id) AS member_count
    FROM family_memberships fm
    JOIN families f ON f.id = fm.family_id
    WHERE fm.user_id = $1
    ORDER BY CASE fm.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'contributor' THEN 3 ELSE 4 END,
             f.name, f.id
  `, [userId]);
  return result.rows;
}

async function getFamilyMembership(userId, familyId, client = db) {
  await ready;
  if (!familyId) return null;
  const result = await client.query(`
    SELECT f.id, f.name, f.owner_user_id, fm.role, fm.joined_at
    FROM family_memberships fm
    JOIN families f ON f.id = fm.family_id
    WHERE fm.user_id = $1 AND fm.family_id = $2
  `, [userId, familyId]);
  return result.rows[0] || null;
}

async function ensureActiveFamily(req) {
  let family = await getFamilyMembership(req.session.userId, req.session.activeFamilyId);
  if (!family) {
    const families = await listFamilies(req.session.userId);
    family = families[0] || null;
    if (family) req.session.activeFamilyId = family.id;
  }
  return family;
}

async function createFamily(userId, name, client = db) {
  await ready;
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('Family name is required');
  const result = await client.query(
    'INSERT INTO families (name, owner_user_id) VALUES ($1, $2) RETURNING id, name, owner_user_id',
    [trimmedName, userId]
  );
  const family = result.rows[0];
  await client.query(
    "INSERT INTO family_memberships (family_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT (family_id, user_id) DO UPDATE SET role = 'owner'",
    [family.id, userId]
  );
  return { ...family, role: 'owner', member_count: 1 };
}

async function inspectInvitation(token, client = db, forUpdate = false) {
  await ready;
  if (!token) return null;
  const lockClause = forUpdate ? ' FOR UPDATE OF fi' : '';
  const result = await client.query(`
    SELECT fi.id, fi.family_id, fi.email, fi.role, fi.expires_at, fi.accepted_at,
           f.name AS family_name
    FROM family_invitations fi
    JOIN families f ON f.id = fi.family_id
    WHERE fi.token_hash = $1${lockClause}
  `, [hashToken(token)]);
  return result.rows[0] || null;
}

async function acceptInvitation({ token, userId, email, client = db }) {
  await ready;
  const invitation = await inspectInvitation(token, client, true);
  if (!invitation) throw Object.assign(new Error('Invitation not found'), { status: 404 });
  if (invitation.accepted_at) throw Object.assign(new Error('Invitation has already been used'), { status: 410 });
  if (new Date(invitation.expires_at) <= new Date()) throw Object.assign(new Error('Invitation has expired'), { status: 410 });
  if (normalizeEmail(invitation.email) !== normalizeEmail(email)) {
    throw Object.assign(new Error('Sign in with the email address that was invited'), { status: 403 });
  }

  await client.query(`
    INSERT INTO family_memberships (family_id, user_id, role)
    VALUES ($1, $2, $3)
    ON CONFLICT (family_id, user_id) DO NOTHING
  `, [invitation.family_id, userId, invitation.role]);
  await client.query('UPDATE family_invitations SET accepted_at = now() WHERE id = $1', [invitation.id]);
  return getFamilyMembership(userId, invitation.family_id, client);
}

async function userContext(userId, activeFamilyId, client = db) {
  const userResult = await client.query('SELECT id, email, family_name, account_status, is_superadmin, approved_at, rejection_reason FROM users WHERE id = $1', [userId]);
  const user = userResult.rows[0];
  if (!user) return null;
  const families = await listFamilies(userId, client);
  const activeFamily = families.find((family) => Number(family.id) === Number(activeFamilyId)) || families[0] || null;
  return {
    ...user,
    families,
    active_family: activeFamily,
    active_family_id: activeFamily ? activeFamily.id : null,
    active_family_role: activeFamily ? activeFamily.role : null
  };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

async function requireFamily(req, res, next) {
  try {
    await ready;
    const family = await ensureActiveFamily(req);
    if (!family) return res.status(403).json({ error: 'No family access is available for this account' });
    req.family = family;
    next();
  } catch (error) {
    next(error);
  }
}

function requireRole(minimumRole) {
  return (req, res, next) => {
    const current = req.family && ROLE_LEVEL[req.family.role];
    if (!current || current < ROLE_LEVEL[minimumRole]) {
      return res.status(403).json({ error: `${minimumRole} access or higher is required` });
    }
    next();
  };
}

function registerRoutes(app) {
  const router = express.Router();

  router.get('/invitations/:token', async (req, res, next) => {
    try {
      const invitation = await inspectInvitation(req.params.token);
      if (!invitation) return res.status(404).json({ error: 'Invitation not found' });
      if (invitation.accepted_at) return res.status(410).json({ error: 'Invitation has already been used' });
      if (new Date(invitation.expires_at) <= new Date()) return res.status(410).json({ error: 'Invitation has expired' });
      res.json({
        family_name: invitation.family_name,
        role: invitation.role,
        invited_email: maskEmail(invitation.email),
        expires_at: invitation.expires_at
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/invitations/:token/accept', requireAuth, async (req, res, next) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const userResult = await client.query('SELECT email FROM users WHERE id = $1', [req.session.userId]);
      const family = await acceptInvitation({
        token: req.params.token,
        userId: req.session.userId,
        email: userResult.rows[0] && userResult.rows[0].email,
        client
      });
      await client.query('COMMIT');
      req.session.activeFamilyId = family.id;
      res.json({ family });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.status) return res.status(error.status).json({ error: error.message });
      next(error);
    } finally {
      client.release();
    }
  });

  router.use('/families', requireAuth);

  router.get('/families', async (req, res, next) => {
    try {
      const families = await listFamilies(req.session.userId);
      res.json({ families, active_family_id: req.session.activeFamilyId || (families[0] && families[0].id) || null });
    } catch (error) {
      next(error);
    }
  });

  router.post('/families', async (req, res, next) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const family = await createFamily(req.session.userId, req.body.name, client);
      await client.query('COMMIT');
      req.session.activeFamilyId = family.id;
      res.status(201).json({ family });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.message === 'Family name is required') return res.status(400).json({ error: error.message });
      next(error);
    } finally {
      client.release();
    }
  });

  router.post('/families/:id/select', async (req, res, next) => {
    try {
      const family = await getFamilyMembership(req.session.userId, req.params.id);
      if (!family) return res.status(404).json({ error: 'Family not found or access denied' });
      req.session.activeFamilyId = family.id;
      res.json({ family });
    } catch (error) {
      next(error);
    }
  });

  router.use('/family', requireAuth, requireFamily);

  router.get('/family/members', async (req, res, next) => {
    try {
      const result = await db.query(`
        SELECT u.id, u.email, u.family_name, fm.role, fm.joined_at
        FROM family_memberships fm
        JOIN users u ON u.id = fm.user_id
        WHERE fm.family_id = $1
        ORDER BY CASE fm.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'contributor' THEN 3 ELSE 4 END,
                 lower(u.email)
      `, [req.family.id]);
      res.json({ family: req.family, members: result.rows });
    } catch (error) {
      next(error);
    }
  });

  router.get('/family/invitations', requireRole('admin'), async (req, res, next) => {
    try {
      const result = await db.query(`
        SELECT id, email, role, expires_at, accepted_at, created_at
        FROM family_invitations
        WHERE family_id = $1 AND accepted_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC
      `, [req.family.id]);
      res.json({ invitations: result.rows });
    } catch (error) {
      next(error);
    }
  });

  router.post('/family/invitations', requireRole('admin'), async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body.email);
      const role = String(req.body.role || 'viewer');
      if (!email || !email.includes('@')) return res.status(400).json({ error: 'A valid email is required' });
      if (!INVITABLE_ROLES.has(role)) return res.status(400).json({ error: 'Role must be viewer, contributor, or admin' });
      if (role === 'admin' && req.family.role !== 'owner') {
        return res.status(403).json({ error: 'Only the family owner can invite administrators' });
      }

      const existing = await db.query(`
        SELECT 1 FROM family_memberships fm
        JOIN users u ON u.id = fm.user_id
        WHERE fm.family_id = $1 AND lower(u.email) = $2
      `, [req.family.id, email]);
      if (existing.rows.length) return res.status(409).json({ error: 'This person is already a family member' });

      const token = crypto.randomBytes(32).toString('hex');
      const invitation = await db.query(`
        INSERT INTO family_invitations (family_id, email, role, token_hash, invited_by, expires_at)
        VALUES ($1, $2, $3, $4, $5, now() + interval '7 days')
        RETURNING id, email, role, expires_at, created_at
      `, [req.family.id, email, role, hashToken(token), req.session.userId]);

      res.status(201).json({
        invitation: invitation.rows[0],
        invite_token: token,
        invite_path: `/?invite=${encodeURIComponent(token)}`
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/family/invitations/:id', requireRole('admin'), async (req, res, next) => {
    try {
      const result = await db.query(
        'DELETE FROM family_invitations WHERE id = $1 AND family_id = $2 AND accepted_at IS NULL RETURNING id',
        [req.params.id, req.family.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Invitation not found' });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/family/members/:userId', requireRole('admin'), async (req, res, next) => {
    try {
      const role = String(req.body.role || '');
      if (!['viewer', 'contributor', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Role must be viewer, contributor, or admin' });
      }
      const target = await db.query(
        'SELECT role FROM family_memberships WHERE family_id = $1 AND user_id = $2',
        [req.family.id, req.params.userId]
      );
      if (!target.rows.length) return res.status(404).json({ error: 'Member not found' });
      if (target.rows[0].role === 'owner') return res.status(403).json({ error: 'The owner role cannot be changed' });
      if ((target.rows[0].role === 'admin' || role === 'admin') && req.family.role !== 'owner') {
        return res.status(403).json({ error: 'Only the owner can manage administrators' });
      }
      await db.query('UPDATE family_memberships SET role = $1 WHERE family_id = $2 AND user_id = $3', [role, req.family.id, req.params.userId]);
      res.json({ success: true, role });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/family/members/:userId', requireRole('admin'), async (req, res, next) => {
    try {
      const target = await db.query(
        'SELECT role FROM family_memberships WHERE family_id = $1 AND user_id = $2',
        [req.family.id, req.params.userId]
      );
      if (!target.rows.length) return res.status(404).json({ error: 'Member not found' });
      if (target.rows[0].role === 'owner') return res.status(403).json({ error: 'The family owner cannot be removed' });
      if (target.rows[0].role === 'admin' && req.family.role !== 'owner') {
        return res.status(403).json({ error: 'Only the owner can remove administrators' });
      }
      await db.query('DELETE FROM family_memberships WHERE family_id = $1 AND user_id = $2', [req.family.id, req.params.userId]);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  app.use('/api', router);
}

module.exports = {
  ROLE_LEVEL,
  ready,
  listFamilies,
  getFamilyMembership,
  ensureActiveFamily,
  createFamily,
  inspectInvitation,
  acceptInvitation,
  userContext,
  requireAuth,
  requireFamily,
  requireRole,
  registerRoutes
};