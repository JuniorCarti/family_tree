const express = require('express');
const db = require('./db');
const privacyAccess = require('./privacy-access');
const trustAccess = require('./trust-access');

const EVENT_TYPES = new Set(['birth', 'education', 'marriage', 'residence', 'work', 'migration', 'milestone', 'death', 'other']);
const VISIBILITIES = new Set(['family', 'contributors', 'admins', 'private']);
const ROLE_LEVEL = privacyAccess.ROLE_LEVEL;

async function initializeArchive() {
  await privacyAccess.ready;
  const client = await db.pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('lineage_archive_v1'))");
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS life_events (
        id SERIAL PRIMARY KEY,
        family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
        event_type VARCHAR(30) NOT NULL,
        title VARCHAR(180) NOT NULL,
        event_date VARCHAR(50),
        end_date VARCHAR(50),
        place VARCHAR(255),
        description TEXT,
        source_title VARCHAR(255),
        source_url TEXT,
        visibility VARCHAR(20) NOT NULL DEFAULT 'family',
        created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now(),
        deleted_at TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS family_stories (
        id SERIAL PRIMARY KEY,
        family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        title VARCHAR(220) NOT NULL,
        body TEXT NOT NULL,
        story_date VARCHAR(50),
        place VARCHAR(255),
        visibility VARCHAR(20) NOT NULL DEFAULT 'family',
        created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now(),
        deleted_at TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS family_story_people (
        story_id INTEGER NOT NULL REFERENCES family_stories(id) ON DELETE CASCADE,
        person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
        PRIMARY KEY (story_id, person_id)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS family_story_comments (
        id SERIAL PRIMARY KEY,
        story_id INTEGER NOT NULL REFERENCES family_stories(id) ON DELETE CASCADE,
        family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        body VARCHAR(2000) NOT NULL,
        created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        deleted_at TIMESTAMP
      )
    `);
    await client.query("ALTER TABLE life_events DROP CONSTRAINT IF EXISTS life_events_event_type_check");
    await client.query('ALTER TABLE life_events ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION');
    await client.query('ALTER TABLE life_events ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION');
    await client.query("ALTER TABLE life_events ADD CONSTRAINT life_events_event_type_check CHECK (event_type IN ('birth','education','marriage','residence','work','migration','milestone','death','other')) NOT VALID");
    await client.query("ALTER TABLE life_events DROP CONSTRAINT IF EXISTS life_events_visibility_check");
    await client.query("ALTER TABLE life_events ADD CONSTRAINT life_events_visibility_check CHECK (visibility IN ('family','contributors','admins','private')) NOT VALID");
    await client.query("ALTER TABLE family_stories DROP CONSTRAINT IF EXISTS family_stories_visibility_check");
    await client.query("ALTER TABLE family_stories ADD CONSTRAINT family_stories_visibility_check CHECK (visibility IN ('family','contributors','admins','private')) NOT VALID");
    await client.query('CREATE INDEX IF NOT EXISTS idx_life_events_family_date ON life_events(family_id, event_date, id) WHERE deleted_at IS NULL');
    await client.query('CREATE INDEX IF NOT EXISTS idx_life_events_person ON life_events(person_id) WHERE deleted_at IS NULL');
    await client.query('CREATE INDEX IF NOT EXISTS idx_stories_family_date ON family_stories(family_id, story_date, id) WHERE deleted_at IS NULL');
    await client.query('CREATE INDEX IF NOT EXISTS idx_story_people_person ON family_story_people(person_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_story_comments_story ON family_story_comments(story_id, created_at) WHERE deleted_at IS NULL');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('lineage_archive_v1'))").catch(() => {});
    client.release();
  }
}

const ready = initializeArchive();

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function validateVisibility(value) {
  if (!VISIBILITIES.has(value)) throw httpError(400, 'Invalid archive visibility');
}

function validateUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    return url.toString();
  } catch {
    throw httpError(400, 'Source link must be a valid http or https URL');
  }
}

function optionalText(value, maxLength, label) {
  const text = String(value ?? '').trim();
  if (text.length > maxLength) throw httpError(400, `${label} must be under ${maxLength.toLocaleString()} characters`);
  return text || null;
}

function optionalCoordinate(value, minimum, maximum, label) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw httpError(400, `${label} must be between ${minimum} and ${maximum}`);
  }
  return number;
}

function hasVisibility(visibility, creatorId, userId, role) {
  if (Number(creatorId) === Number(userId)) return true;
  const level = ROLE_LEVEL[role] || 0;
  if (visibility === 'family') return level >= ROLE_LEVEL.viewer;
  if (visibility === 'contributors') return level >= ROLE_LEVEL.contributor;
  if (visibility === 'admins') return level >= ROLE_LEVEL.admin;
  return false;
}

function canUsePerson(person, userId, role) {
  const visible = privacyAccess.serializePerson(person, userId, role);
  return Boolean(visible && !visible.privacy_redacted);
}

function canManage(record, userId, role) {
  if (Number(record.created_by_user_id) === Number(userId)) return (ROLE_LEVEL[role] || 0) >= ROLE_LEVEL.contributor;
  return (ROLE_LEVEL[role] || 0) >= ROLE_LEVEL.admin && record.visibility !== 'private';
}

async function activePerson(id, familyId, client = db) {
  const result = await client.query(
    'SELECT * FROM persons WHERE id = $1 AND family_id = $2 AND deleted_at IS NULL',
    [id, familyId]
  );
  return result.rows[0];
}

async function storyTags(storyIds, familyId, client = db) {
  if (!storyIds.length) return new Map();
  const result = await client.query(`
    SELECT sp.story_id, p.*
    FROM family_story_people sp
    JOIN persons p ON p.id = sp.person_id
    WHERE sp.story_id = ANY($1) AND p.family_id = $2 AND p.deleted_at IS NULL
    ORDER BY p.last_name, p.first_name
  `, [storyIds, familyId]);
  const tags = new Map(storyIds.map((id) => [Number(id), []]));
  for (const row of result.rows) tags.get(Number(row.story_id))?.push(row);
  return tags;
}

function serializeEvent(event, userId, role) {
  if (!hasVisibility(event.visibility, event.created_by_user_id, userId, role)) return null;
  const person = {
    ...event,
    visibility: event.person_visibility,
    created_by_user_id: event.person_creator_id
  };
  if (!canUsePerson(person, userId, role)) return null;
  return {
    id: event.id,
    family_id: event.family_id,
    person_id: event.person_id,
    person_name: [event.first_name, event.last_name].filter(Boolean).join(' '),
    person_photo_url: event.photo_url || null,
    event_type: event.event_type,
    title: event.title,
    event_date: event.event_date,
    end_date: event.end_date,
    place: event.place,
    latitude: event.latitude,
    longitude: event.longitude,
    description: event.description,
    source_title: event.source_title,
    source_url: event.source_url,
    visibility: event.visibility,
    created_at: event.created_at,
    updated_at: event.updated_at,
    can_edit: canManage(event, userId, role)
  };
}

function serializeStory(story, people, userId, role) {
  if (!hasVisibility(story.visibility, story.created_by_user_id, userId, role)) return null;
  if (people.some((person) => !canUsePerson(person, userId, role))) return null;
  return {
    id: story.id,
    family_id: story.family_id,
    title: story.title,
    body: story.body,
    story_date: story.story_date,
    place: story.place,
    visibility: story.visibility,
    author_name: story.author_name || 'Family contributor',
    created_at: story.created_at,
    updated_at: story.updated_at,
    comment_count: Number(story.comment_count || 0),
    people: people.map((person) => ({
      id: person.id,
      name: [person.first_name, person.last_name].filter(Boolean).join(' '),
      photo_url: person.photo_url || null
    })),
    can_edit: canManage(story, userId, role)
  };
}

async function listEvents(req) {
  const params = [req.family.id];
  const where = ['e.family_id = $1', 'e.deleted_at IS NULL', 'p.deleted_at IS NULL'];
  if (req.query.person_id) {
    params.push(Number(req.query.person_id));
    where.push(`e.person_id = $${params.length}`);
  }
  if (req.query.type && EVENT_TYPES.has(String(req.query.type))) {
    params.push(String(req.query.type));
    where.push(`e.event_type = $${params.length}`);
  }
  const q = String(req.query.q || '').trim();
  if (q) {
    params.push(`%${q}%`);
    where.push(`(e.title ILIKE $${params.length} OR e.description ILIKE $${params.length} OR e.place ILIKE $${params.length} OR p.first_name ILIKE $${params.length} OR p.last_name ILIKE $${params.length})`);
  }
  const result = await db.query(`
    SELECT e.*, p.first_name, p.last_name, p.maiden_name, p.gender, p.birth_date,
           p.death_date, p.birth_place, p.photo_url, p.notes, p.life_status,
           p.visibility AS person_visibility, p.created_by_user_id AS person_creator_id
    FROM life_events e
    JOIN persons p ON p.id = e.person_id
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(e.event_date, '9999') ASC, e.id ASC
  `, params);
  return result.rows
    .map((row) => serializeEvent(row, req.session.userId, req.family.role))
    .filter(Boolean);
}

async function listStories(req) {
  const params = [req.family.id];
  const where = ['s.family_id = $1', 's.deleted_at IS NULL'];
  const q = String(req.query.q || '').trim();
  if (q) {
    params.push(`%${q}%`);
    where.push(`(s.title ILIKE $${params.length} OR s.body ILIKE $${params.length} OR s.place ILIKE $${params.length})`);
  }
  if (req.query.person_id) {
    params.push(Number(req.query.person_id));
    where.push(`EXISTS (SELECT 1 FROM family_story_people sfp WHERE sfp.story_id = s.id AND sfp.person_id = $${params.length})`);
  }
  const result = await db.query(`
    SELECT s.*, COALESCE(u.family_name, split_part(u.email, '@', 1)) AS author_name,
           (SELECT count(*) FROM family_story_comments c WHERE c.story_id = s.id AND c.deleted_at IS NULL) AS comment_count
    FROM family_stories s
    LEFT JOIN users u ON u.id = s.created_by_user_id
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(s.story_date, to_char(s.created_at, 'YYYY-MM-DD')) DESC, s.id DESC
  `, params);
  const tags = await storyTags(result.rows.map((story) => story.id), req.family.id);
  return result.rows.map((story) =>
    serializeStory(story, tags.get(Number(story.id)) || [], req.session.userId, req.family.role)
  ).filter(Boolean);
}

function requireContributor(req, res, next) {
  if ((ROLE_LEVEL[req.family.role] || 0) < ROLE_LEVEL.contributor) {
    return res.status(403).json({ error: 'Contributor access is required' });
  }
  next();
}

function registerRoutes(app) {
  const router = express.Router();

  router.get('/overview', async (req, res, next) => {
    try {
      const [events, stories] = await Promise.all([listEvents(req), listStories(req)]);
      const years = events.map((event) => String(event.event_date || '').match(/\d{4}/)?.[0]).filter(Boolean).map(Number);
      res.json({
        stats: {
          events: events.length,
          stories: stories.length,
          storytellers: new Set(stories.map((story) => story.author_name)).size,
          years_spanned: years.length ? Math.max(...years) - Math.min(...years) : 0
        },
        recent_events: events.slice(-5).reverse(),
        recent_stories: stories.slice(0, 4)
      });
    } catch (error) { next(error); }
  });

  router.get('/events', async (req, res, next) => {
    try { res.json({ events: await listEvents(req) }); } catch (error) { next(error); }
  });

  router.post('/events', requireContributor, async (req, res, next) => {
    try {
      const person = await activePerson(Number(req.body.person_id), req.family.id);
      if (!person) throw httpError(404, 'Person not found');
      if (!privacyAccess.canEdit(person, req.session.userId, req.family.role)) throw httpError(403, 'You cannot add events to this private profile');
      const eventType = String(req.body.event_type || 'other');
      const title = String(req.body.title || '').trim();
      const visibility = String(req.body.visibility || 'family');
      if (!EVENT_TYPES.has(eventType)) throw httpError(400, 'Invalid event type');
      if (!title || title.length > 180) throw httpError(400, 'Event title is required and must be under 180 characters');
      validateVisibility(visibility);
      const result = await db.query(`
        INSERT INTO life_events
          (family_id, person_id, event_type, title, event_date, end_date, place, description,
           source_title, source_url, visibility, created_by_user_id, latitude, longitude)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *
      `, [req.family.id, person.id, eventType, title, optionalText(req.body.event_date, 50, 'Event date'),
        optionalText(req.body.end_date, 50, 'End date'), optionalText(req.body.place, 255, 'Place'),
        optionalText(req.body.description, 10000, 'Description'),
        optionalText(req.body.source_title, 255, 'Source title'),
        validateUrl(String(req.body.source_url || '').trim()), visibility, req.session.userId,
        optionalCoordinate(req.body.latitude, -90, 90, 'Latitude'),
        optionalCoordinate(req.body.longitude, -180, 180, 'Longitude')]);
      await trustAccess.audit(req, 'archive.event_created', 'life_event', result.rows[0].id, null, result.rows[0]);
      const rows = await listEvents({ ...req, query: { person_id: person.id } });
      res.status(201).json(rows.find((event) => event.id === result.rows[0].id));
    } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
  });

  router.put('/events/:id', requireContributor, async (req, res, next) => {
    try {
      const found = await db.query('SELECT * FROM life_events WHERE id = $1 AND family_id = $2 AND deleted_at IS NULL', [req.params.id, req.family.id]);
      const existing = found.rows[0];
      if (!existing) throw httpError(404, 'Event not found');
      if (!canManage(existing, req.session.userId, req.family.role)) throw httpError(403, 'You cannot edit this event');
      const merged = { ...existing, ...req.body };
      if (!EVENT_TYPES.has(merged.event_type)) throw httpError(400, 'Invalid event type');
      validateVisibility(merged.visibility);
      const title = String(merged.title || '').trim();
      if (!title || title.length > 180) throw httpError(400, 'Event title is required and must be under 180 characters');
      const result = await db.query(`
        UPDATE life_events SET event_type=$1,title=$2,event_date=$3,end_date=$4,place=$5,
          description=$6,source_title=$7,source_url=$8,visibility=$9,latitude=$10,
          longitude=$11,updated_at=now()
        WHERE id=$12 AND family_id=$13 AND deleted_at IS NULL RETURNING *
      `, [merged.event_type, title, optionalText(merged.event_date, 50, 'Event date'),
        optionalText(merged.end_date, 50, 'End date'), optionalText(merged.place, 255, 'Place'),
        optionalText(merged.description, 10000, 'Description'),
        optionalText(merged.source_title, 255, 'Source title'),
        validateUrl(String(merged.source_url || '').trim()), merged.visibility,
        optionalCoordinate(merged.latitude, -90, 90, 'Latitude'),
        optionalCoordinate(merged.longitude, -180, 180, 'Longitude'), existing.id, req.family.id]);
      await trustAccess.audit(req, 'archive.event_updated', 'life_event', existing.id, existing, result.rows[0]);
      res.json({ success: true });
    } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
  });

  router.delete('/events/:id', requireContributor, async (req, res, next) => {
    try {
      const found = await db.query('SELECT * FROM life_events WHERE id=$1 AND family_id=$2 AND deleted_at IS NULL', [req.params.id, req.family.id]);
      const existing = found.rows[0];
      if (!existing) throw httpError(404, 'Event not found');
      if (!canManage(existing, req.session.userId, req.family.role)) throw httpError(403, 'You cannot delete this event');
      await db.query('UPDATE life_events SET deleted_at=now(),updated_at=now() WHERE id=$1 AND family_id=$2', [existing.id, req.family.id]);
      await trustAccess.audit(req, 'archive.event_deleted', 'life_event', existing.id, existing, null);
      res.json({ success: true });
    } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
  });

  router.get('/stories', async (req, res, next) => {
    try { res.json({ stories: await listStories(req) }); } catch (error) { next(error); }
  });

  router.get('/stories/:id', async (req, res, next) => {
    try {
      const stories = await listStories({ ...req, query: {} });
      const story = stories.find((item) => Number(item.id) === Number(req.params.id));
      if (!story) return res.status(404).json({ error: 'Story not found' });
      const comments = await db.query(`
        SELECT c.id,c.body,c.created_by_user_id,c.created_at,
               COALESCE(u.family_name, split_part(u.email, '@', 1), 'Family member') AS author_name
        FROM family_story_comments c LEFT JOIN users u ON u.id=c.created_by_user_id
        WHERE c.story_id=$1 AND c.family_id=$2 AND c.deleted_at IS NULL ORDER BY c.created_at
      `, [story.id, req.family.id]);
      res.json({ story, comments: comments.rows.map((comment) => ({
        ...comment,
        can_delete: Number(comment.created_by_user_id) === Number(req.session.userId) || (ROLE_LEVEL[req.family.role] || 0) >= ROLE_LEVEL.admin
      })) });
    } catch (error) { next(error); }
  });

  router.post('/stories', requireContributor, async (req, res, next) => {
    const client = await db.pool.connect();
    try {
      const title = String(req.body.title || '').trim();
      const body = String(req.body.body || '').trim();
      const visibility = String(req.body.visibility || 'family');
      const personIds = [...new Set((req.body.person_ids || []).map(Number).filter(Number.isInteger))].slice(0, 30);
      if (!title || title.length > 220) throw httpError(400, 'Story title is required and must be under 220 characters');
      if (!body || body.length > 20000) throw httpError(400, 'Story text is required and must be under 20,000 characters');
      validateVisibility(visibility);
      await client.query('BEGIN');
      if (personIds.length) {
        const people = await client.query('SELECT * FROM persons WHERE id=ANY($1) AND family_id=$2 AND deleted_at IS NULL', [personIds, req.family.id]);
        if (people.rows.length !== personIds.length || people.rows.some((person) => !privacyAccess.canEdit(person, req.session.userId, req.family.role))) {
          throw httpError(403, 'One or more tagged people are unavailable or private');
        }
      }
      const result = await client.query(`
        INSERT INTO family_stories (family_id,title,body,story_date,place,visibility,created_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
      `, [req.family.id, title, body, optionalText(req.body.story_date, 50, 'Story date'),
        optionalText(req.body.place, 255, 'Place'), visibility, req.session.userId]);
      for (const personId of personIds) {
        await client.query('INSERT INTO family_story_people (story_id,person_id) VALUES ($1,$2)', [result.rows[0].id, personId]);
      }
      await client.query('COMMIT');
      await trustAccess.audit(req, 'archive.story_created', 'family_story', result.rows[0].id, null, { ...result.rows[0], person_ids: personIds });
      const stories = await listStories({ ...req, query: {} });
      res.status(201).json(stories.find((story) => story.id === result.rows[0].id));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(error.status || 500).json({ error: error.message });
    } finally { client.release(); }
  });

  router.put('/stories/:id', requireContributor, async (req, res, next) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query('SELECT * FROM family_stories WHERE id=$1 AND family_id=$2 AND deleted_at IS NULL FOR UPDATE', [req.params.id, req.family.id]);
      const existing = found.rows[0];
      if (!existing) throw httpError(404, 'Story not found');
      if (!canManage(existing, req.session.userId, req.family.role)) throw httpError(403, 'You cannot edit this story');
      const merged = { ...existing, ...req.body };
      const title = String(merged.title || '').trim();
      const body = String(merged.body || '').trim();
      validateVisibility(merged.visibility);
      if (!title || title.length > 220 || !body || body.length > 20000) throw httpError(400, 'Enter a valid title and story');
      const personIds = [...new Set((req.body.person_ids || []).map(Number).filter(Number.isInteger))].slice(0, 30);
      if (personIds.length) {
        const people = await client.query('SELECT * FROM persons WHERE id=ANY($1) AND family_id=$2 AND deleted_at IS NULL', [personIds, req.family.id]);
        if (people.rows.length !== personIds.length || people.rows.some((person) => !privacyAccess.canEdit(person, req.session.userId, req.family.role))) throw httpError(403, 'One or more tagged people are unavailable or private');
      }
      const result = await client.query(`
        UPDATE family_stories SET title=$1,body=$2,story_date=$3,place=$4,visibility=$5,updated_at=now()
        WHERE id=$6 AND family_id=$7 RETURNING *
      `, [title, body, optionalText(merged.story_date, 50, 'Story date'), optionalText(merged.place, 255, 'Place'),
        merged.visibility, existing.id, req.family.id]);
      await client.query('DELETE FROM family_story_people WHERE story_id=$1', [existing.id]);
      for (const personId of personIds) await client.query('INSERT INTO family_story_people(story_id,person_id) VALUES($1,$2)', [existing.id, personId]);
      await client.query('COMMIT');
      await trustAccess.audit(req, 'archive.story_updated', 'family_story', existing.id, existing, { ...result.rows[0], person_ids: personIds });
      res.json({ success: true });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(error.status || 500).json({ error: error.message });
    } finally { client.release(); }
  });

  router.delete('/stories/:id', requireContributor, async (req, res, next) => {
    try {
      const found = await db.query('SELECT * FROM family_stories WHERE id=$1 AND family_id=$2 AND deleted_at IS NULL', [req.params.id, req.family.id]);
      const existing = found.rows[0];
      if (!existing) throw httpError(404, 'Story not found');
      if (!canManage(existing, req.session.userId, req.family.role)) throw httpError(403, 'You cannot delete this story');
      await db.query('UPDATE family_stories SET deleted_at=now(),updated_at=now() WHERE id=$1 AND family_id=$2', [existing.id, req.family.id]);
      await trustAccess.audit(req, 'archive.story_deleted', 'family_story', existing.id, existing, null);
      res.json({ success: true });
    } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
  });

  router.post('/stories/:id/comments', async (req, res, next) => {
    try {
      const stories = await listStories({ ...req, query: {} });
      const story = stories.find((item) => Number(item.id) === Number(req.params.id));
      if (!story) return res.status(404).json({ error: 'Story not found' });
      const body = String(req.body.body || '').trim();
      if (!body || body.length > 2000) return res.status(400).json({ error: 'Comment is required and must be under 2,000 characters' });
      const result = await db.query(`
        INSERT INTO family_story_comments(story_id,family_id,body,created_by_user_id)
        VALUES($1,$2,$3,$4) RETURNING *
      `, [story.id, req.family.id, body, req.session.userId]);
      await trustAccess.audit(req, 'archive.comment_created', 'story_comment', result.rows[0].id, null, { story_id: story.id });
      res.status(201).json(result.rows[0]);
    } catch (error) { next(error); }
  });

  router.delete('/comments/:id', async (req, res, next) => {
    try {
      const found = await db.query('SELECT * FROM family_story_comments WHERE id=$1 AND family_id=$2 AND deleted_at IS NULL', [req.params.id, req.family.id]);
      const comment = found.rows[0];
      if (!comment) return res.status(404).json({ error: 'Comment not found' });
      if (Number(comment.created_by_user_id) !== Number(req.session.userId) && (ROLE_LEVEL[req.family.role] || 0) < ROLE_LEVEL.admin) {
        return res.status(403).json({ error: 'You cannot delete this comment' });
      }
      await db.query('UPDATE family_story_comments SET deleted_at=now() WHERE id=$1 AND family_id=$2', [comment.id, req.family.id]);
      await trustAccess.audit(req, 'archive.comment_deleted', 'story_comment', comment.id, comment, null);
      res.json({ success: true });
    } catch (error) { next(error); }
  });

  router.get('/export', async (req, res, next) => {
    try {
      const [events, stories] = await Promise.all([listEvents(req), listStories(req)]);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="lineage-family-archive.json"');
      res.json({ exported_at: new Date().toISOString(), family: { id: req.family.id, name: req.family.name }, events, stories });
    } catch (error) { next(error); }
  });

  app.use('/api/archive', router);
}

module.exports = { ready, registerRoutes, listEvents, listStories, EVENT_TYPES };
