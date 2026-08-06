require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const ExcelJS = require('exceljs');
const db = require('./db');
const familyAccess = require('./family-access');
const platformAccess = require('./platform-access');
const trustAccess = require('./trust-access');
const mediaStorage = require('./media-storage');
const privacyAccess = require('./privacy-access');
const archiveAccess = require('./archive-access');
const explorationAccess = require('./exploration-access');
const evidenceAccess = require('./evidence-access');
const gedcomAccess = require('./gedcom-access');
const memoryAccess = require('./memory-access');
const qualityCollabAccess = require('./quality-collab-access');
const discoveryLocalizationAccess = require('./discovery-localization-access');
const treeEngine = require('./public/tree-layout');

const app = express();
const PORT = process.env.PORT || 4000;
if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('SESSION_SECRET must be set to at least 32 characters in production');
}

// Firebase Hosting forwards requests through a proxy before they reach
// Cloud Run. Trust that proxy so secure session cookies are set correctly.
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors());
app.use(express.json());

// Session configuration
app.use(session({
  name: '__session',
  store: new pgSession({ pool: db.pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'a-very-secure-secret-key-12345',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

// Legacy disk uploads are retained for existing records but are no longer
// publicly exposed through express.static.
app.get('/uploads/:filename', async (req, res, next) => {
  try {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
    const access = await platformAccess.getAccountAccess(req.session.userId);
    if (!access?.email_verified_at || access.account_status !== 'approved') {
      return res.status(403).json({ error: 'Account access is required' });
    }
    const relativeUrl = `/uploads/${path.basename(req.params.filename)}`;
    const allowed = await db.query(`
      SELECT p.*, fm.role FROM persons p
      JOIN family_memberships fm ON fm.family_id = p.family_id
      WHERE p.photo_url = $1 AND fm.user_id = $2 AND p.deleted_at IS NULL
      LIMIT 1
    `, [relativeUrl, req.session.userId]);
    if (!allowed.rows.length) return res.status(404).json({ error: 'Media not found' });
    const person = allowed.rows[0];
    const visible = privacyAccess.serializePerson(person, req.session.userId, person.role);
    if (!visible || visible.privacy_redacted) return res.status(404).json({ error: 'Media not found' });
    res.sendFile(path.join(__dirname, 'public', 'uploads', path.basename(req.params.filename)));
  } catch (error) {
    next(error);
  }
});
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.get('/api/public/memories/:token', (req, res, next) => memoryAccess.publicMemory(req, res, next));
app.get('/api/public/memories/:token/media', (req, res, next) => memoryAccess.publicMemoryMedia(req, res, next));
app.get('/memory/:token', (req, res) => memoryAccess.publicMemoryPage(req, res));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false
});
trustAccess.registerRoutes(app, authLimiter);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function getPerson(id, familyId, includeDeleted = false) {
  const result = await db.query(
    `SELECT * FROM persons WHERE id = $1 AND family_id = $2 ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`,
    [id, familyId]
  );
  return result.rows[0];
}

function visiblePerson(person, req) {
  return privacyAccess.serializePerson(person, req.session.userId, req.family.role);
}

function requirePersonEdit(person, req, res) {
  if (privacyAccess.canEdit(person, req.session.userId, req.family.role)) return true;
  res.status(403).json({ error: 'You do not have permission to change this private profile' });
  return false;
}

// ---------------------------------------------------------------------------
// Auth Routes
// ---------------------------------------------------------------------------
app.get('/api/auth/session', async (req, res, next) => {
  if (!req.session.userId) return res.json({ authenticated: false });
  try {
    const context = await familyAccess.userContext(req.session.userId, req.session.activeFamilyId);
    if (!context) return res.json({ authenticated: false });
    req.session.activeFamilyId = context.active_family_id;
    res.json({ authenticated: true, context });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', async (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  try {
    const context = await familyAccess.userContext(req.session.userId, req.session.activeFamilyId);
    if (!context) return res.status(404).json({ error: 'User not found' });
    req.session.activeFamilyId = context.active_family_id;
    res.json(context);
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/signup', authLimiter, async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const familyName = String(req.body.family_name || '').trim();
  const inviteToken = String(req.body.invite_token || '').trim();

  if (!email || !password || (!familyName && !inviteToken)) {
    return res.status(400).json({ error: 'Email, password, and a family name or invitation are required' });
  }
  if (password.length < 12) {
    return res.status(400).json({ error: 'Password must be at least 12 characters' });
  }

  const client = await db.pool.connect();
  try {
    await Promise.all([familyAccess.ready, platformAccess.ready, trustAccess.ready]);
    await client.query('BEGIN');
    const hash = await bcrypt.hash(password, 10);
    const result = await client.query(
      'INSERT INTO users (email, password_hash, family_name) VALUES ($1, $2, $3) RETURNING id, email, family_name',
      [email, hash, familyName || 'Invited family member']
    );
    const user = result.rows[0];
    await platformAccess.applyBootstrapAccess(user.id, user.email, client);

    let activeFamily;
    if (inviteToken) {
      activeFamily = await familyAccess.acceptInvitation({ token: inviteToken, userId: user.id, email, client });
    } else {
      activeFamily = await familyAccess.createFamily(user.id, familyName, client);
    }

    await client.query('COMMIT');
    const verification = await trustAccess.issueVerification(user, req, client);
    req.session.userId = user.id;
    req.session.activeFamilyId = activeFamily.id;
    const context = await familyAccess.userContext(user.id, activeFamily.id);
    const response = { ...context, verification_email_sent: verification.delivered };
    if (process.env.NODE_ENV === 'test') response.test_verification_token = verification.token;
    res.status(201).json(response);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  } finally {
    client.release();
  }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  try {
    await Promise.all([familyAccess.ready, platformAccess.ready]);
    const result = await db.query('SELECT * FROM users WHERE lower(email) = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const context = await familyAccess.userContext(user.id, req.session.activeFamilyId);
    await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
    req.session.userId = user.id;
    req.session.activeFamilyId = context.active_family_id;
    res.json(context);
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('__session');
    res.json({ success: true });
  });
});

const requireAuth = familyAccess.requireAuth;
const requireApproved = platformAccess.requireApproved;
const requireFamily = familyAccess.requireFamily;
const requireRole = familyAccess.requireRole;

platformAccess.registerRoutes(app);
explorationAccess.registerPublicRoutes(app);
evidenceAccess.registerRoutes(app, { requireAuth, requireApproved, requireFamily, requireRole });
gedcomAccess.registerRoutes(app, { requireAuth, requireApproved, requireFamily, requireRole });
memoryAccess.registerRoutes(app, { requireAuth, requireApproved, requireFamily, requireRole });
qualityCollabAccess.registerRoutes(app, { requireAuth, requireApproved, requireFamily, requireRole });
discoveryLocalizationAccess.registerRoutes(app, { requireAuth, requireApproved, requireFamily, requireRole });

app.use('/api/account', requireAuth, requireApproved);

app.get('/api/account/data-export', async (req, res, next) => {
  try {
    const [user, memberships, persons, relationships, payments, lifeEvents, stories, comments] = await Promise.all([
      db.query(`SELECT id, email, family_name, created_at, email_verified_at, account_status,
                       approved_at
                FROM users WHERE id = $1`, [req.session.userId]),
      db.query(`SELECT f.id AS family_id, f.name, fm.role, fm.joined_at
                FROM family_memberships fm JOIN families f ON f.id = fm.family_id
                WHERE fm.user_id = $1 ORDER BY fm.joined_at`, [req.session.userId]),
      db.query(`SELECT id, family_id, first_name, last_name, maiden_name, gender, birth_date,
                       death_date, birth_place, notes, life_status, visibility, created_at,
                       updated_at, deleted_at
                FROM persons WHERE created_by_user_id = $1 ORDER BY id`, [req.session.userId]),
      db.query(`SELECT id, family_id, type, person1_id, person2_id, label, status,
                       start_date, end_date
                FROM relationships WHERE created_by_user_id = $1 ORDER BY id`, [req.session.userId]),
      db.query(`SELECT id, amount_kes, payment_phone, payer_phone, mpesa_reference,
                       status, review_note, reviewed_at, created_at
                FROM account_payment_submissions WHERE user_id = $1 ORDER BY created_at`, [req.session.userId]),
      db.query(`SELECT id, family_id, person_id, event_type, title, event_date, end_date,
                       place, latitude, longitude, description, source_title, source_url, visibility, created_at,
                       updated_at, deleted_at
                FROM life_events WHERE created_by_user_id = $1 ORDER BY id`, [req.session.userId]),
      db.query(`SELECT s.id, s.family_id, s.title, s.body, s.story_date, s.place, s.visibility,
                       s.created_at, s.updated_at, s.deleted_at,
                       COALESCE(array_agg(sp.person_id) FILTER (WHERE sp.person_id IS NOT NULL), '{}') AS person_ids
                FROM family_stories s
                LEFT JOIN family_story_people sp ON sp.story_id = s.id
                WHERE s.created_by_user_id = $1
                GROUP BY s.id ORDER BY s.id`, [req.session.userId]),
      db.query(`SELECT id, story_id, family_id, body, created_at, deleted_at
                FROM family_story_comments WHERE created_by_user_id = $1 ORDER BY id`, [req.session.userId])
    ]);
    const payload = {
      exported_at: new Date().toISOString(),
      account: user.rows[0],
      family_memberships: memberships.rows,
      payment_submissions: payments.rows,
      contributed_people: persons.rows,
      contributed_relationships: relationships.rows,
      contributed_life_events: lifeEvents.rows,
      contributed_stories: stories.rows,
      contributed_story_comments: comments.rows
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=lineage-account-data.json');
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/account', async (req, res, next) => {
  const password = String(req.body.password || '');
  const confirmation = String(req.body.confirmation || '');
  if (confirmation !== 'DELETE MY ACCOUNT') {
    return res.status(400).json({ error: 'Type DELETE MY ACCOUNT to confirm' });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query('SELECT id, password_hash, is_superadmin FROM users WHERE id = $1 FOR UPDATE', [req.session.userId]);
    const user = userResult.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'Password is incorrect' });
    }
    if (user.is_superadmin) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'The platform superadmin account cannot be deleted here' });
    }
    const sharedOwned = await client.query(`
      SELECT f.id, f.name, count(fm.user_id)::int AS member_count
      FROM families f JOIN family_memberships fm ON fm.family_id = f.id
      WHERE f.owner_user_id = $1
      GROUP BY f.id, f.name
      HAVING count(fm.user_id) > 1
    `, [req.session.userId]);
    if (sharedOwned.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Transfer ownership of your shared families before deleting your account',
        families: sharedOwned.rows
      });
    }
    await client.query('DELETE FROM families WHERE owner_user_id = $1', [req.session.userId]);
    await client.query('DELETE FROM users WHERE id = $1', [req.session.userId]);
    await client.query('COMMIT');
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie('__session');
      res.json({ success: true });
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

// The invitation acceptance endpoint remains available while an account is
// locked. All family listing, administration, and data routes require approval.
app.use('/api/families', requireAuth, requireApproved);
app.use('/api/family', requireAuth, requireApproved);
familyAccess.registerRoutes(app);

app.patch('/api/family/owner', requireAuth, requireApproved, requireFamily, requireRole('owner'), async (req, res, next) => {
  const newOwnerId = Number(req.body.user_id);
  if (!Number.isInteger(newOwnerId) || newOwnerId === Number(req.session.userId)) {
    return res.status(400).json({ error: 'Choose another current family member as the new owner' });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const family = await client.query('SELECT id, owner_user_id FROM families WHERE id = $1 FOR UPDATE', [req.family.id]);
    if (!family.rows[0] || Number(family.rows[0].owner_user_id) !== Number(req.session.userId)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Only the current owner can transfer ownership' });
    }
    const target = await client.query(
      'SELECT role FROM family_memberships WHERE family_id = $1 AND user_id = $2 FOR UPDATE',
      [req.family.id, newOwnerId]
    );
    if (!target.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'The new owner must already be a family member' });
    }
    await client.query(
      `UPDATE family_memberships SET role = CASE WHEN user_id = $1 THEN 'owner' ELSE 'admin' END
       WHERE family_id = $2 AND user_id IN ($1, $3)`,
      [newOwnerId, req.family.id, req.session.userId]
    );
    await client.query('UPDATE families SET owner_user_id = $1, updated_at = now() WHERE id = $2', [newOwnerId, req.family.id]);
    await client.query('COMMIT');
    await trustAccess.audit(req, 'family.ownership_transferred', 'family', req.family.id,
      { owner_user_id: req.session.userId }, { owner_user_id: newOwnerId });
    res.json({ success: true, owner_user_id: newOwnerId, previous_owner_role: 'admin' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

app.get('/api/family/audit', requireAuth, requireApproved, requireFamily, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const result = await db.query(`
      SELECT al.id, al.action, al.entity_type, al.entity_id, al.before_data, al.after_data,
             al.created_at, u.email AS actor_email
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.actor_user_id
      WHERE al.family_id = $1
      ORDER BY al.created_at DESC, al.id DESC
      LIMIT $2
    `, [req.family.id, limit]);
    res.json({ entries: result.rows });
  } catch (error) {
    next(error);
  }
});

app.use('/api/persons', requireAuth, requireApproved, requireFamily);
app.use('/api/relationships', requireAuth, requireApproved, requireFamily);
app.use('/api/tree', requireAuth, requireApproved, requireFamily);
app.use('/api/export', requireAuth, requireApproved, requireFamily);
app.use('/api/merge', requireAuth, requireApproved, requireFamily);
app.use('/api/duplicates', requireAuth, requireApproved, requireFamily);
app.use('/api/media', requireAuth, requireApproved, requireFamily);
app.use('/api/recycle-bin', requireAuth, requireApproved, requireFamily);
app.use('/api/archive', requireAuth, requireApproved, requireFamily);
app.use('/api/exploration', requireAuth, requireApproved, requireFamily);
archiveAccess.registerRoutes(app);
explorationAccess.registerRoutes(app);

app.post('/api/upload', requireAuth, requireApproved, requireFamily, requireRole('contributor'), mediaStorage.upload.single('photo'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const asset = await mediaStorage.save(req, req.file);
    await trustAccess.audit(req, 'media.uploaded', 'media_asset', asset.id, null, { mime_type: req.file.mimetype, size: req.file.size });
    res.json({ url: asset.url, durable: mediaStorage.durable });
  } catch (error) {
    next(error);
  }
});
app.get('/api/media/:id', (req, res, next) => mediaStorage.stream(req, res).catch(next));

app.get('/api/recycle-bin/persons', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT p.*, u.email AS deleted_by_email, p.deleted_at + interval '30 days' AS expires_at
      FROM persons p
      LEFT JOIN users u ON u.id = p.deleted_by_user_id
      WHERE p.family_id = $1 AND p.deleted_at IS NOT NULL
      ORDER BY p.deleted_at DESC
    `, [req.family.id]);
    const people = result.rows.map((person) => ({
      ...privacyAccess.serializePerson({ ...person, deleted_at: null }, req.session.userId, req.family.role),
      deleted_at: person.deleted_at,
      deletion_reason: person.deletion_reason,
      deleted_by_email: person.deleted_by_email,
      expires_at: person.expires_at
    }));
    res.json({ persons: people });
  } catch (error) {
    next(error);
  }
});

app.post('/api/recycle-bin/persons/:id/restore', requireRole('admin'), async (req, res, next) => {
  try {
    const existing = await getPerson(req.params.id, req.family.id, true);
    if (!existing || !existing.deleted_at) return res.status(404).json({ error: 'Deleted person not found' });
    const result = await db.query(`
      UPDATE persons SET deleted_at = NULL, deleted_by_user_id = NULL, deletion_reason = NULL, updated_at = now()
      WHERE id = $1 AND family_id = $2 AND deleted_at IS NOT NULL RETURNING *
    `, [req.params.id, req.family.id]);
    await trustAccess.audit(req, 'person.restored', 'person', existing.id, existing, result.rows[0]);
    res.json(visiblePerson(result.rows[0], req));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/recycle-bin/persons/:id', requireRole('owner'), async (req, res, next) => {
  try {
    const existing = await getPerson(req.params.id, req.family.id, true);
    if (!existing || !existing.deleted_at) return res.status(404).json({ error: 'Deleted person not found' });
    await db.query('DELETE FROM persons WHERE id = $1 AND family_id = $2 AND deleted_at IS NOT NULL', [req.params.id, req.family.id]);
    await trustAccess.audit(req, 'person.permanently_deleted', 'person', existing.id, existing, null);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
// ---------------------------------------------------------------------------
// Persons CRUD
// ---------------------------------------------------------------------------
app.get('/api/persons', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM persons WHERE family_id = $1 AND deleted_at IS NULL ORDER BY last_name, first_name', [req.family.id]);
    res.json(privacyAccess.serializePeople(result.rows, req.session.userId, req.family.role));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/persons/:id', async (req, res) => {
  try {
    const person = await getPerson(req.params.id, req.family.id);
    if (!person) return res.status(404).json({ error: 'Person not found' });
    res.json(visiblePerson(person, req));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/persons', requireRole('contributor'), async (req, res) => {
  const {
    first_name, last_name = '', maiden_name = '', gender = 'unknown',
    birth_date = null, death_date = null, birth_place = null,
    photo_url = null, notes = null, life_status = 'living', visibility = 'family'
  } = req.body;

  if (!first_name || !first_name.trim()) {
    return res.status(400).json({ error: 'first_name is required' });
  }

  try {
    privacyAccess.validatePrivacy({ life_status, visibility });
    const result = await db.query(`
      INSERT INTO persons (first_name, last_name, maiden_name, gender, birth_date, death_date, birth_place, photo_url, notes, user_id, family_id, created_by_user_id, life_status, visibility)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `, [first_name.trim(), last_name, maiden_name, gender, birth_date, death_date, birth_place, photo_url, notes, req.session.userId, req.family.id, req.session.userId, life_status, visibility]);

    await trustAccess.audit(req, 'person.created', 'person', result.rows[0].id, null, result.rows[0]);
    res.status(201).json(visiblePerson(result.rows[0], req));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.put('/api/persons/:id', requireRole('contributor'), async (req, res) => {
  try {
    const existing = await getPerson(req.params.id, req.family.id);
    if (!existing) return res.status(404).json({ error: 'Person not found' });
    if (!requirePersonEdit(existing, req, res)) return;

    const merged = { ...existing, ...req.body };
    privacyAccess.validatePrivacy(merged);
    const result = await db.query(`
      UPDATE persons SET
        first_name = $1, last_name = $2, maiden_name = $3,
        gender = $4, birth_date = $5, death_date = $6,
        birth_place = $7, photo_url = $8, notes = $9,
        life_status = $10, visibility = $11,
        updated_at = now()
      WHERE id = $12 AND family_id = $13 AND deleted_at IS NULL
      RETURNING *
    `, [
      merged.first_name, merged.last_name, merged.maiden_name,
      merged.gender, merged.birth_date, merged.death_date,
      merged.birth_place, merged.photo_url, merged.notes,
      merged.life_status, merged.visibility,
      existing.id, req.family.id
    ]);

    await trustAccess.audit(req, 'person.updated', 'person', existing.id, existing, result.rows[0]);
    res.json(visiblePerson(result.rows[0], req));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete('/api/persons/:id', requireRole('contributor'), async (req, res) => {
  try {
    const existing = await getPerson(req.params.id, req.family.id);
    if (!existing) return res.status(404).json({ error: 'Person not found' });
    if (!requirePersonEdit(existing, req, res)) return;

    const reason = String(req.body?.reason || '').trim().slice(0, 500) || null;
    await db.query(`UPDATE persons SET deleted_at = now(), deleted_by_user_id = $1, deletion_reason = $2, updated_at = now()
                    WHERE id = $3 AND family_id = $4 AND deleted_at IS NULL`,
      [req.session.userId, reason, req.params.id, req.family.id]);
    await trustAccess.audit(req, 'person.soft_deleted', 'person', existing.id, existing, { deleted: true, reason });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Relationships CRUD
// ---------------------------------------------------------------------------
app.get('/api/relationships', async (req, res) => {
  try {
    const result = await db.query(`SELECT r.* FROM relationships r
      JOIN persons p1 ON p1.id = r.person1_id AND p1.deleted_at IS NULL
      JOIN persons p2 ON p2.id = r.person2_id AND p2.deleted_at IS NULL
      WHERE r.family_id = $1`, [req.family.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/relationships', requireRole('contributor'), async (req, res) => {
  const { type, person1_id, person2_id, label = null, status = 'married', start_date = null, end_date = null } = req.body;

  const validTypes = ['parent', 'spouse', 'relative', 'sibling', 'grandparent', 'grandchild', 'aunt_uncle', 'niece_nephew', 'cousin'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
  }
  if (!person1_id || !person2_id || person1_id === person2_id) {
    return res.status(400).json({ error: 'person1_id and person2_id are required and must differ' });
  }

  try {
    const p1 = await getPerson(person1_id, req.family.id);
    const p2 = await getPerson(person2_id, req.family.id);
    if (!p1 || !p2) {
      return res.status(404).json({ error: 'One or both persons not found' });
    }
    if (!requirePersonEdit(p1, req, res) || !requirePersonEdit(p2, req, res)) return;

    const result = await db.query(`
      INSERT INTO relationships (type, person1_id, person2_id, label, status, start_date, end_date, user_id, family_id, created_by_user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [type, person1_id, person2_id, label, status, start_date, end_date, req.session.userId, req.family.id, req.session.userId]);

    await trustAccess.audit(req, 'relationship.created', 'relationship', result.rows[0].id, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (String(err).includes('unique constraint') || String(err).includes('UNIQUE')) {
      return res.status(409).json({ error: 'This relationship already exists' });
    }
    res.status(500).json({ error: 'Could not create relationship' });
  }
});

app.delete('/api/relationships/:id', requireRole('contributor'), async (req, res) => {
  try {
    const relationship = await db.query('SELECT * FROM relationships WHERE id = $1 AND family_id = $2', [req.params.id, req.family.id]);
    if (!relationship.rows[0]) return res.status(404).json({ error: 'Relationship not found' });
    const [p1, p2] = await Promise.all([
      getPerson(relationship.rows[0].person1_id, req.family.id),
      getPerson(relationship.rows[0].person2_id, req.family.id)
    ]);
    if (!p1 || !p2 || !requirePersonEdit(p1, req, res) || !requirePersonEdit(p2, req, res)) return;
    const deleted = await db.query('DELETE FROM relationships WHERE id = $1 AND family_id = $2 RETURNING *', [req.params.id, req.family.id]);
    if (deleted.rows[0]) await trustAccess.audit(req, 'relationship.deleted', 'relationship', req.params.id, deleted.rows[0], null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Duplicates / Merge
// ---------------------------------------------------------------------------
app.get('/api/duplicates', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT lower(first_name) as fname, lower(last_name) as lname, array_agg(id) as ids, count(*) as count
      FROM persons
      WHERE family_id = $1 AND deleted_at IS NULL
      GROUP BY lower(first_name), lower(last_name)
      HAVING count(*) > 1
    `, [req.family.id]);

    const duplicates = [];
    for (const row of result.rows) {
      const peopleReq = await db.query('SELECT * FROM persons WHERE id = ANY($1) AND deleted_at IS NULL', [row.ids]);
      const visible = privacyAccess.serializePeople(peopleReq.rows, req.session.userId, req.family.role)
        .filter((person) => !person.privacy_redacted);
      if (visible.length > 1) duplicates.push({ group: `${row.fname || ''} ${row.lname || ''}`.trim(), persons: visible });
    }
    res.json(duplicates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/merge', requireRole('contributor'), async (req, res) => {
  const { keepId, mergeIds } = req.body;
  if (!keepId || !mergeIds || !Array.isArray(mergeIds) || mergeIds.length === 0) {
    return res.status(400).json({ error: 'Missing keepId or mergeIds' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Check ownership
    const checkUser = await client.query('SELECT * FROM persons WHERE id = ANY($1) AND family_id = $2 AND deleted_at IS NULL', [[keepId, ...mergeIds], req.family.id]);
    if (checkUser.rows.length !== mergeIds.length + 1) {
      throw new Error('Not all persons found or owned by user');
    }
    if (checkUser.rows.some((person) => !privacyAccess.canEdit(person, req.session.userId, req.family.role))) {
      const forbidden = Object.assign(new Error('You cannot merge a profile whose details are private'), { status: 403 });
      throw forbidden;
    }

    // Update person1_id where it's safe (no conflict, no self-referencing)
    await client.query(`
      UPDATE relationships r1
      SET person1_id = $1
      WHERE person1_id = ANY($2) AND family_id = $3
        AND r1.person2_id <> $1
        AND NOT EXISTS (
          SELECT 1 FROM relationships r2
          WHERE r2.type = r1.type 
            AND r2.person1_id = $1 
            AND r2.person2_id = r1.person2_id
            AND r2.family_id = $3
        )
    `, [keepId, mergeIds, req.family.id]);

    // Update person2_id where it's safe
    await client.query(`
      UPDATE relationships r1
      SET person2_id = $1
      WHERE person2_id = ANY($2) AND family_id = $3
        AND r1.person1_id <> $1
        AND NOT EXISTS (
          SELECT 1 FROM relationships r2
          WHERE r2.type = r1.type 
            AND r2.person1_id = r1.person1_id 
            AND r2.person2_id = $1
            AND r2.family_id = $3
        )
    `, [keepId, mergeIds, req.family.id]);

    // Delete any relations left pointing to mergeIds (which means they would have conflicted)
    await client.query(`
      DELETE FROM relationships 
      WHERE (person1_id = ANY($1) OR person2_id = ANY($1)) AND family_id = $2
    `, [mergeIds, req.family.id]);

    // Finally delete the persons
    await client.query(`
      DELETE FROM persons
      WHERE id = ANY($1) AND family_id = $2
    `, [mergeIds, req.family.id]);

    await client.query('COMMIT');
    await trustAccess.audit(req, 'persons.merged', 'person', keepId, { merge_ids: mergeIds }, { kept_id: keepId });
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Full tree payload
// ---------------------------------------------------------------------------
app.get('/api/tree', async (req, res) => {
  try {
    const pResult = await db.query('SELECT * FROM persons WHERE family_id = $1 AND deleted_at IS NULL ORDER BY last_name, first_name', [req.family.id]);
    const rResult = await db.query(`SELECT r.* FROM relationships r
      JOIN persons p1 ON p1.id = r.person1_id AND p1.deleted_at IS NULL
      JOIN persons p2 ON p2.id = r.person2_id AND p2.deleted_at IS NULL
      WHERE r.family_id = $1`, [req.family.id]);
    const persons = privacyAccess.serializePeople(pResult.rows, req.session.userId, req.family.role);
    const relationships = treeEngine.withDerivedRelationships(persons, rResult.rows);
    res.json({
      tree: { id: req.family.id, name: req.family.name, role: req.family.role },
      persons,
      relationships
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/tree', requireRole('admin'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Family name is required' });
  try {
    const result = await db.query(
      'UPDATE families SET name = $1, updated_at = now() WHERE id = $2 RETURNING id, name',
      [name, req.family.id]
    );
    await trustAccess.audit(req, 'family.renamed', 'family', req.family.id, { name: req.family.name }, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
app.get('/api/export/excel', async (req, res) => {
  try {
    const family_name = req.family.name || 'My Family Tree';

    const pResult = await db.query('SELECT * FROM persons WHERE family_id = $1 AND deleted_at IS NULL', [req.family.id]);
    const persons = privacyAccess.serializePeople(pResult.rows, req.session.userId, req.family.role);

    const rResult = await db.query(`SELECT r.* FROM relationships r
      JOIN persons p1 ON p1.id = r.person1_id AND p1.deleted_at IS NULL
      JOIN persons p2 ON p2.id = r.person2_id AND p2.deleted_at IS NULL
      WHERE r.family_id = $1`, [req.family.id]);
    const storedRels = rResult.rows;

    const parentsOf = new Map();
    const childrenOf = new Map();
    const spousesOf = new Map();
    const siblingsOf = new Map();
    const grandparentsOf = new Map();
    const grandchildrenOf = new Map();
    const auntUnclesOf = new Map();
    const nieceNephewsOf = new Map();
    const cousinsOf = new Map();
    const relativesOf = new Map();

    const pMap = new Map();

    for (const p of persons) {
      pMap.set(p.id, p);
      parentsOf.set(p.id, []);
      childrenOf.set(p.id, []);
      spousesOf.set(p.id, []);
      siblingsOf.set(p.id, []);
      grandparentsOf.set(p.id, []);
      grandchildrenOf.set(p.id, []);
      auntUnclesOf.set(p.id, []);
      nieceNephewsOf.set(p.id, []);
      cousinsOf.set(p.id, []);
      relativesOf.set(p.id, []);
    }

    const finalRels = new Set();
    function addRel(p1Id, p2Id, typeString) {
      if (p1Id === p2Id) return;
      finalRels.add(`${p1Id}|${p2Id}|${typeString}`);
    }

    for (const r of storedRels) {
      if (r.type === 'parent') {
        childrenOf.get(r.person1_id)?.push(r.person2_id);
        parentsOf.get(r.person2_id)?.push(r.person1_id);
        addRel(r.person1_id, r.person2_id, 'Parent of');
        addRel(r.person2_id, r.person1_id, 'Child of');
      } else if (r.type === 'spouse') {
        spousesOf.get(r.person1_id)?.push(r.person2_id);
        spousesOf.get(r.person2_id)?.push(r.person1_id);
        addRel(r.person1_id, r.person2_id, 'Spouse of');
        addRel(r.person2_id, r.person1_id, 'Spouse of');
      } else if (r.type === 'sibling') {
        siblingsOf.get(r.person1_id)?.push(r.person2_id);
        siblingsOf.get(r.person2_id)?.push(r.person1_id);
        addRel(r.person1_id, r.person2_id, 'Sibling of');
        addRel(r.person2_id, r.person1_id, 'Sibling of');
      } else if (r.type === 'grandparent') {
        grandparentsOf.get(r.person2_id)?.push(r.person1_id);
        grandchildrenOf.get(r.person1_id)?.push(r.person2_id);
        addRel(r.person1_id, r.person2_id, 'Grandparent of');
        addRel(r.person2_id, r.person1_id, 'Grandchild of');
      } else if (r.type === 'grandchild') {
        grandchildrenOf.get(r.person2_id)?.push(r.person1_id);
        grandparentsOf.get(r.person1_id)?.push(r.person2_id);
        addRel(r.person1_id, r.person2_id, 'Grandchild of');
        addRel(r.person2_id, r.person1_id, 'Grandparent of');
      } else if (r.type === 'aunt_uncle') {
        auntUnclesOf.get(r.person2_id)?.push(r.person1_id);
        nieceNephewsOf.get(r.person1_id)?.push(r.person2_id);
        addRel(r.person1_id, r.person2_id, 'Aunt/Uncle of');
        addRel(r.person2_id, r.person1_id, 'Niece/Nephew of');
      } else if (r.type === 'niece_nephew') {
        nieceNephewsOf.get(r.person2_id)?.push(r.person1_id);
        auntUnclesOf.get(r.person1_id)?.push(r.person2_id);
        addRel(r.person1_id, r.person2_id, 'Niece/Nephew of');
        addRel(r.person2_id, r.person1_id, 'Aunt/Uncle of');
      } else if (r.type === 'cousin') {
        cousinsOf.get(r.person1_id)?.push(r.person2_id);
        cousinsOf.get(r.person2_id)?.push(r.person1_id);
        addRel(r.person1_id, r.person2_id, 'Cousin of');
        addRel(r.person2_id, r.person1_id, 'Cousin of');
      } else if (r.type === 'relative') {
        relativesOf.get(r.person1_id)?.push(r.person2_id);
        relativesOf.get(r.person2_id)?.push(r.person1_id);
        const label = r.label ? r.label : 'Other Relative';
        addRel(r.person1_id, r.person2_id, label);
        addRel(r.person2_id, r.person1_id, label);
      }
    }

    for (const p of persons) {
      const parents = parentsOf.get(p.id) || [];
      for (const parentId of parents) {
        const kids = childrenOf.get(parentId) || [];
        for (const kidId of kids) {
          if (kidId !== p.id && !(siblingsOf.get(p.id) || []).includes(kidId)) {
            siblingsOf.get(p.id).push(kidId);
            addRel(p.id, kidId, 'Sibling of');
          }
        }
      }
    }

    for (const p of persons) {
      const parents = parentsOf.get(p.id) || [];
      for (const parentId of parents) {
        const gparents = parentsOf.get(parentId) || [];
        for (const gpId of gparents) {
          if (!(grandparentsOf.get(p.id) || []).includes(gpId)) {
            grandparentsOf.get(p.id).push(gpId);
            addRel(p.id, gpId, 'Grandchild of');
            addRel(gpId, p.id, 'Grandparent of');
          }
        }
      }
    }

    for (const p of persons) {
      const children = childrenOf.get(p.id) || [];
      for (const childId of children) {
        const gchildren = childrenOf.get(childId) || [];
        for (const gcId of gchildren) {
          if (!(grandchildrenOf.get(p.id) || []).includes(gcId)) {
            grandchildrenOf.get(p.id).push(gcId);
            addRel(p.id, gcId, 'Grandparent of');
            addRel(gcId, p.id, 'Grandchild of');
          }
        }
      }
    }

    for (const p of persons) {
      const parents = parentsOf.get(p.id) || [];
      for (const parentId of parents) {
        const siblings = siblingsOf.get(parentId) || [];
        for (const sibId of siblings) {
          if (!(auntUnclesOf.get(p.id) || []).includes(sibId)) {
            auntUnclesOf.get(p.id).push(sibId);
            addRel(p.id, sibId, 'Niece/Nephew of');
            addRel(sibId, p.id, 'Aunt/Uncle of');
          }
        }
      }
    }

    for (const p of persons) {
      const siblings = siblingsOf.get(p.id) || [];
      for (const sibId of siblings) {
        const kids = childrenOf.get(sibId) || [];
        for (const kidId of kids) {
          if (!(nieceNephewsOf.get(p.id) || []).includes(kidId)) {
            nieceNephewsOf.get(p.id).push(kidId);
            addRel(p.id, kidId, 'Aunt/Uncle of');
            addRel(kidId, p.id, 'Niece/Nephew of');
          }
        }
      }
    }

    for (const p of persons) {
      const parents = parentsOf.get(p.id) || [];
      for (const parentId of parents) {
        const siblings = siblingsOf.get(parentId) || [];
        for (const sibId of siblings) {
          const kids = childrenOf.get(sibId) || [];
          for (const kidId of kids) {
            if (kidId !== p.id && !(cousinsOf.get(p.id) || []).includes(kidId)) {
              cousinsOf.get(p.id).push(kidId);
              addRel(p.id, kidId, 'Cousin of');
              addRel(kidId, p.id, 'Cousin of');
            }
          }
        }
      }
    }

    const workbook = new ExcelJS.Workbook();

    const sheet1 = workbook.addWorksheet('People');
    sheet1.columns = [
      { header: 'Family Name', key: 'family', width: 22 },
      { header: 'First Name', key: 'first', width: 18 },
      { header: 'Last Name', key: 'last', width: 18 },
      { header: 'Maiden Name', key: 'maiden', width: 18 },
      { header: 'Gender', key: 'gender', width: 12 },
      { header: 'Birth Date', key: 'birth_date', width: 15 },
      { header: 'Death Date', key: 'death_date', width: 15 },
      { header: 'Birth Place', key: 'birth_place', width: 25 },
      { header: 'Notes', key: 'notes', width: 40 }
    ];

    for (const p of persons) {
      sheet1.addRow({
        family: family_name,
        first: p.first_name,
        last: p.last_name,
        maiden: p.maiden_name,
        gender: p.gender,
        birth_date: p.birth_date,
        death_date: p.death_date,
        birth_place: p.birth_place,
        notes: p.notes
      });
    }
    sheet1.getRow(1).font = { bold: true };

    const sheet2 = workbook.addWorksheet('Relationships');
    sheet2.columns = [
      { header: 'Family Name', key: 'family', width: 22 },
      { header: 'Person', key: 'person', width: 25 },
      { header: 'Relationship', key: 'relationship', width: 20 },
      { header: 'Related To', key: 'related_to', width: 25 }
    ];

    for (const item of finalRels) {
      const parts = item.split('|');
      const p1Id = Number(parts[0]);
      const p2Id = Number(parts[1]);
      const typeStr = parts[2];
      const p1 = pMap.get(p1Id);
      const p2 = pMap.get(p2Id);

      if (p1 && p2) {
        const p1Name = [p1.first_name, p1.last_name].filter(Boolean).join(' ');
        const p2Name = [p2.first_name, p2.last_name].filter(Boolean).join(' ');
        sheet2.addRow({
          family: family_name,
          person: p1Name,
          relationship: typeStr,
          related_to: p2Name
        });
      }
    }
    sheet2.getRow(1).font = { bold: true };

    const safeFamilyName = family_name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFamilyName}_family_tree.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

if (require.main === module) {
  Promise.all([db.ready, familyAccess.ready, platformAccess.ready, trustAccess.ready, mediaStorage.ready, privacyAccess.ready, archiveAccess.ready, explorationAccess.ready, evidenceAccess.ready, gedcomAccess.ready, memoryAccess.ready, qualityCollabAccess.ready, discoveryLocalizationAccess.ready])
    .then(() => {
      app.listen(PORT, () => {
        console.log('Family tree server running at http://localhost:' + PORT);
      });
    })
    .catch((error) => {
      console.error('Server startup failed:', error);
      process.exitCode = 1;
    });
}

module.exports = { app };
