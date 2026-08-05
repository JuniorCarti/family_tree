const crypto = require('crypto');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const PDFDocument = require('pdfkit');
const db = require('./db');
const privacyAccess = require('./privacy-access');
const trustAccess = require('./trust-access');
const familyAccess = require('./family-access');
const treeEngine = require('./public/tree-layout');

const SHARE_VIEWS = new Set(['family', 'pedigree', 'descendants', 'fan', 'hourglass', 'list']);
const SLICE_DIRECTIONS = new Set(['family', 'ancestors', 'descendants', 'hourglass']);

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function normalizeDepth(value, fallback = 4) {
  if (value === 'all') return 'all';
  return Math.max(1, Math.min(Number(value) || fallback, 8));
}

async function initializeExploration() {
  await Promise.all([db.ready, privacyAccess.ready]);
  const client = await db.pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('lineage_exploration_v1'))");
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS family_share_links (
        id BIGSERIAL PRIMARY KEY,
        family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL UNIQUE,
        label VARCHAR(120),
        view_type VARCHAR(30) NOT NULL DEFAULT 'family',
        focus_person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
        generation_depth INTEGER NOT NULL DEFAULT 4 CHECK (generation_depth BETWEEN 1 AND 8),
        include_living BOOLEAN NOT NULL DEFAULT false,
        created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        expires_at TIMESTAMP NOT NULL,
        revoked_at TIMESTAMP,
        last_accessed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_family_share_links_family ON family_share_links(family_id, created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_family_share_links_active ON family_share_links(token_hash, expires_at) WHERE revoked_at IS NULL');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('lineage_exploration_v1'))").catch(() => {});
    client.release();
  }
}

const ready = initializeExploration();

async function loadTreeData(familyId, userId, role, options = {}) {
  await ready;
  const [familyResult, peopleResult, relationshipResult] = await Promise.all([
    db.query('SELECT id, name FROM families WHERE id = $1', [familyId]),
    db.query('SELECT * FROM persons WHERE family_id = $1 AND deleted_at IS NULL ORDER BY last_name, first_name, id', [familyId]),
    db.query(`
      SELECT r.* FROM relationships r
      JOIN persons first_person ON first_person.id = r.person1_id AND first_person.deleted_at IS NULL
      JOIN persons second_person ON second_person.id = r.person2_id AND second_person.deleted_at IS NULL
      WHERE r.family_id = $1
    `, [familyId]),
  ]);
  let persons = privacyAccess.serializePeople(peopleResult.rows, userId, role)
    .filter(Boolean)
    .filter((person) => person.privacy_redacted !== 'private');
  if (options.includeLiving === false) persons = persons.filter((person) => person.life_status !== 'living');
  const visibleIds = new Set(persons.map((person) => Number(person.id)));
  const relationships = relationshipResult.rows.filter((relationship) => (
    visibleIds.has(Number(relationship.person1_id)) && visibleIds.has(Number(relationship.person2_id))
  ));
  return {
    tree: familyResult.rows[0],
    persons,
    relationships,
  };
}

function projectData(data, options = {}) {
  const view = SHARE_VIEWS.has(options.view) ? options.view : 'family';
  const focusId = Number(options.focusId);
  if (!focusId || !data.persons.some((person) => Number(person.id) === focusId)) return { ...data, view };
  const direction = view === 'pedigree' || view === 'fan' ? 'ancestors'
    : view === 'descendants' ? 'descendants'
      : view === 'hourglass' ? 'hourglass' : 'family';
  const projection = treeEngine.projectTree(data.persons, data.relationships, {
    focusId,
    direction,
    depth: normalizeDepth(options.depth),
  });
  return { ...data, persons: projection.persons, relationships: projection.relationships, view };
}

function publicBaseUrl(req) {
  const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim();
  const forwardedProtocol = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  return process.env.APP_BASE_URL || `${forwardedProtocol || req.protocol}://${forwardedHost || req.get('host')}`;
}

function serializeSharedPerson(person) {
  return {
    id: person.id,
    first_name: person.first_name,
    middle_name: person.middle_name,
    last_name: person.last_name,
    gender: person.gender,
    birth_date: person.birth_date,
    death_date: person.death_date,
    life_status: person.life_status,
    privacy_redacted: person.privacy_redacted || null,
  };
}

function serializeSharedRelationship(relationship) {
  return {
    id: relationship.id,
    type: relationship.type,
    person1_id: relationship.person1_id,
    person2_id: relationship.person2_id,
    label: relationship.label,
    status: relationship.status,
    start_date: relationship.start_date,
    end_date: relationship.end_date,
  };
}

function registerPublicRoutes(app) {
  const shareLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 240,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.get('/api/shared-tree/:token', shareLimiter, async (req, res, next) => {
    try {
      await ready;
      const result = await db.query(`
        SELECT link.*, family.name AS family_name
        FROM family_share_links link
        JOIN families family ON family.id = link.family_id
        WHERE link.token_hash = $1
          AND link.revoked_at IS NULL
          AND link.expires_at > now()
      `, [hashToken(req.params.token)]);
      const link = result.rows[0];
      if (!link) return res.status(404).json({ error: 'This private family link is invalid or has expired' });
      const data = await loadTreeData(link.family_id, 0, 'viewer', { includeLiving: link.include_living });
      const projected = projectData(data, {
        view: link.view_type,
        focusId: link.focus_person_id,
        depth: link.generation_depth,
      });
      await db.query('UPDATE family_share_links SET last_accessed_at = now() WHERE id = $1', [link.id]);
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        share: {
          label: link.label,
          view: link.view_type,
          focus_person_id: link.focus_person_id,
          generation_depth: link.generation_depth,
          includes_living: link.include_living,
          expires_at: link.expires_at,
        },
        tree: { name: projected.tree?.name || 'Family tree', role: 'shared-viewer' },
        persons: projected.persons.map(serializeSharedPerson),
        relationships: projected.relationships.map(serializeSharedRelationship),
      });
    } catch (error) {
      next(error);
    }
  });
}

function relationshipLabel(relationship) {
  if (relationship.type === 'parent') return 'Parent / child';
  if (relationship.type === 'spouse') return 'Spouse / partner';
  if (relationship.type === 'sibling') return 'Sibling';
  return relationship.label || String(relationship.type || 'Relative').replaceAll('_', ' ');
}

function streamChartPdf(res, data, options = {}) {
  const projected = projectData(data, options);
  const layout = treeEngine.computeTreeLayout(projected.persons, projected.relationships, {
    cardWidth: 132,
    cardHeight: 48,
    spouseGap: 12,
    siblingGap: 26,
    rowHeight: 104,
    padding: 30,
  });
  const document = new PDFDocument({
    size: 'A3',
    layout: 'landscape',
    margin: 28,
    info: {
      Title: `${data.tree.name} family chart`,
      Author: 'Lineage',
      Subject: `${options.view || 'family'} genealogy chart`,
    },
  });
  const filename = String(data.tree.name || 'family-tree').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename || 'family-tree'}-${options.view || 'family'}.pdf"`);
  document.pipe(res);
  document.fillColor('#33261c').font('Times-Bold').fontSize(20).text(data.tree.name || 'Family tree', 30, 24);
  document.fillColor('#8f6526').font('Helvetica').fontSize(9)
    .text(`${String(options.view || 'family').toUpperCase()} · ${projected.persons.length} people · Generated ${new Date().toISOString().slice(0, 10)}`, 30, 50);

  const pageWidth = document.page.width - 60;
  const pageHeight = document.page.height - 100;
  const scale = Math.min(1, pageWidth / Math.max(layout.width, 1), pageHeight / Math.max(layout.height, 1));
  const offsetX = 30 + (pageWidth - layout.width * scale) / 2;
  const offsetY = 78 + Math.max(0, (pageHeight - layout.height * scale) / 2);
  document.save().translate(offsetX, offsetY).scale(scale);

  document.lineWidth(1.2).strokeColor('#b3a077');
  for (const relationship of projected.relationships) {
    const first = layout.personPos.get(relationship.person1_id);
    const second = layout.personPos.get(relationship.person2_id);
    if (!first || !second) continue;
    if (relationship.type === 'parent') {
      const firstX = first.x + first.w / 2;
      const firstY = first.y + first.h;
      const secondX = second.x + second.w / 2;
      const secondY = second.y;
      const middleY = firstY + (secondY - firstY) / 2;
      document.moveTo(firstX, firstY).lineTo(firstX, middleY).lineTo(secondX, middleY).lineTo(secondX, secondY).stroke();
    } else if (relationship.type === 'spouse') {
      document.strokeColor('#b8863b').moveTo(first.x + first.w, first.y + first.h / 2)
        .lineTo(second.x, second.y + second.h / 2).stroke().strokeColor('#b3a077');
    }
  }

  for (const person of projected.persons) {
    const position = layout.personPos.get(person.id);
    if (!position) continue;
    const border = person.gender === 'male' ? '#6e8b74' : person.gender === 'female' ? '#b9667a' : '#9c8f77';
    document.roundedRect(position.x, position.y, position.w, position.h, 7).fillAndStroke('#fbf7ec', border);
    document.fillColor('#33261c').font('Times-Bold').fontSize(10)
      .text([person.first_name, person.last_name].filter(Boolean).join(' '), position.x + 8, position.y + 9, {
        width: position.w - 16,
        height: 15,
        ellipsis: true,
      });
    const birth = person.birth_date ? String(person.birth_date).match(/\d{4}/)?.[0] : '?';
    const death = person.death_date ? String(person.death_date).match(/\d{4}/)?.[0] : null;
    document.fillColor('#6b5a48').font('Helvetica').fontSize(7)
      .text(death ? `${birth || '?'}–${death}` : `b. ${birth || '?'}`, position.x + 8, position.y + 29, {
        width: position.w - 16,
      });
  }
  document.restore();
  document.fillColor('#6b5a48').font('Helvetica').fontSize(7)
    .text('Private family chart · Generated by Lineage', 30, document.page.height - 24, { align: 'right', width: document.page.width - 60 });
  document.end();
}

function registerRoutes(app) {
  const router = express.Router();

  router.get('/tree-slice', async (req, res, next) => {
    try {
      const direction = SLICE_DIRECTIONS.has(req.query.direction) ? req.query.direction : 'family';
      const focusId = Number(req.query.focus_id);
      if (!focusId) return res.status(400).json({ error: 'focus_id is required' });
      const data = await loadTreeData(req.family.id, req.session.userId, req.family.role);
      const projection = treeEngine.projectTree(data.persons, data.relationships, {
        focusId,
        direction,
        depth: normalizeDepth(req.query.depth),
      });
      res.json({
        tree: { ...data.tree, role: req.family.role },
        persons: projection.persons,
        relationships: projection.relationships,
        slice: { focus_person_id: focusId, direction, depth: normalizeDepth(req.query.depth), total_people: data.persons.length },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/chart.pdf', async (req, res, next) => {
    try {
      const data = await loadTreeData(req.family.id, req.session.userId, req.family.role);
      streamChartPdf(res, data, {
        view: SHARE_VIEWS.has(req.query.view) ? req.query.view : 'family',
        focusId: Number(req.query.focus_id) || null,
        depth: normalizeDepth(req.query.depth),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/share-links', familyAccess.requireRole('admin'), async (req, res, next) => {
    try {
      const result = await db.query(`
        SELECT link.id, link.label, link.view_type, link.focus_person_id, link.generation_depth,
               link.include_living, link.expires_at, link.revoked_at, link.last_accessed_at,
               link.created_at, person.first_name, person.last_name
        FROM family_share_links link
        LEFT JOIN persons person ON person.id = link.focus_person_id
        WHERE link.family_id = $1
        ORDER BY link.created_at DESC
        LIMIT 100
      `, [req.family.id]);
      res.json({ links: result.rows });
    } catch (error) {
      next(error);
    }
  });

  router.post('/share-links', familyAccess.requireRole('admin'), async (req, res, next) => {
    try {
      const view = SHARE_VIEWS.has(req.body.view) ? req.body.view : 'family';
      const focusPersonId = req.body.focus_person_id ? Number(req.body.focus_person_id) : null;
      const depth = normalizeDepth(req.body.generation_depth);
      const expiryHours = Math.max(1, Math.min(Number(req.body.expiry_hours) || 168, 24 * 30));
      const label = String(req.body.label || '').trim().slice(0, 120) || null;
      if (focusPersonId) {
        const person = await db.query('SELECT id FROM persons WHERE id = $1 AND family_id = $2 AND deleted_at IS NULL', [focusPersonId, req.family.id]);
        if (!person.rows[0]) return res.status(404).json({ error: 'Focus person not found' });
      }
      const token = crypto.randomBytes(32).toString('base64url');
      const result = await db.query(`
        INSERT INTO family_share_links
          (family_id, token_hash, label, view_type, focus_person_id, generation_depth,
           include_living, created_by_user_id, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now() + ($9 * interval '1 hour'))
        RETURNING id, label, view_type, focus_person_id, generation_depth, include_living,
                  expires_at, created_at
      `, [req.family.id, hashToken(token), label, view, focusPersonId, depth,
        Boolean(req.body.include_living), req.session.userId, expiryHours]);
      await trustAccess.audit(req, 'exploration.share_link_created', 'family_share_link', result.rows[0].id, null, {
        view,
        focus_person_id: focusPersonId,
        generation_depth: depth,
        include_living: Boolean(req.body.include_living),
        expires_at: result.rows[0].expires_at,
      });
      res.status(201).json({
        link: result.rows[0],
        url: `${publicBaseUrl(req)}/?share=${encodeURIComponent(token)}`,
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/share-links/:id', familyAccess.requireRole('admin'), async (req, res, next) => {
    try {
      const result = await db.query(`
        UPDATE family_share_links SET revoked_at = now()
        WHERE id = $1 AND family_id = $2 AND revoked_at IS NULL
        RETURNING id, view_type, expires_at
      `, [req.params.id, req.family.id]);
      if (!result.rows[0]) return res.status(404).json({ error: 'Active share link not found' });
      await trustAccess.audit(req, 'exploration.share_link_revoked', 'family_share_link', result.rows[0].id, result.rows[0], null);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  app.use('/api/exploration', router);
}

module.exports = {
  ready,
  hashToken,
  loadTreeData,
  projectData,
  registerPublicRoutes,
  registerRoutes,
  serializeSharedPerson,
  serializeSharedRelationship,
  streamChartPdf,
};
