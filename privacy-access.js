const db = require('./db');
const trustAccess = require('./trust-access');

const ROLE_LEVEL = { viewer: 1, contributor: 2, admin: 3, owner: 4 };
const VALID_LIFE_STATUSES = new Set(['living', 'deceased', 'unknown']);
const VALID_VISIBILITIES = new Set(['family', 'contributors', 'admins', 'private']);

async function initializePrivacy() {
  await trustAccess.ready;
  const client = await db.pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('lineage_privacy_v1'))");
    await client.query('BEGIN');
    await client.query("ALTER TABLE persons ADD COLUMN IF NOT EXISTS life_status VARCHAR(20) NOT NULL DEFAULT 'unknown'");
    await client.query("ALTER TABLE persons ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'family'");
    await client.query('ALTER TABLE persons ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP');
    await client.query('ALTER TABLE persons ADD COLUMN IF NOT EXISTS deleted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
    await client.query('ALTER TABLE persons ADD COLUMN IF NOT EXISTS deletion_reason VARCHAR(500)');
    await client.query("ALTER TABLE persons DROP CONSTRAINT IF EXISTS persons_life_status_check");
    await client.query("ALTER TABLE persons ADD CONSTRAINT persons_life_status_check CHECK (life_status IN ('living','deceased','unknown')) NOT VALID");
    await client.query("ALTER TABLE persons DROP CONSTRAINT IF EXISTS persons_visibility_check");
    await client.query("ALTER TABLE persons ADD CONSTRAINT persons_visibility_check CHECK (visibility IN ('family','contributors','admins','private')) NOT VALID");
    await client.query('CREATE INDEX IF NOT EXISTS idx_persons_family_active ON persons(family_id, id) WHERE deleted_at IS NULL');
    await client.query('CREATE INDEX IF NOT EXISTS idx_persons_family_deleted ON persons(family_id, deleted_at DESC) WHERE deleted_at IS NOT NULL');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('lineage_privacy_v1'))").catch(() => {});
    client.release();
  }
}

const ready = initializePrivacy();

function validatePrivacy({ life_status, visibility }) {
  if (!VALID_LIFE_STATUSES.has(life_status)) throw Object.assign(new Error('Invalid life status'), { status: 400 });
  if (!VALID_VISIBILITIES.has(visibility)) throw Object.assign(new Error('Invalid visibility'), { status: 400 });
}

function canViewFull(person, userId, role) {
  if (Number(person.created_by_user_id) === Number(userId)) return true;
  const level = ROLE_LEVEL[role] || 0;
  if (person.visibility === 'family') return level >= ROLE_LEVEL.viewer;
  if (person.visibility === 'contributors') return level >= ROLE_LEVEL.contributor;
  if (person.visibility === 'admins') return level >= ROLE_LEVEL.admin;
  return false;
}

function canEdit(person, userId, role) {
  if ((ROLE_LEVEL[role] || 0) < ROLE_LEVEL.contributor) return false;
  return canViewFull(person, userId, role);
}

function birthYear(value) {
  const match = String(value || '').match(/^\d{4}/);
  return match ? match[0] : null;
}

function serializePerson(person, userId, role) {
  if (!person || person.deleted_at) return null;
  if (!canViewFull(person, userId, role)) {
    return {
      id: person.id,
      family_id: person.family_id,
      first_name: 'Private',
      last_name: 'relative',
      maiden_name: '',
      gender: 'unknown',
      life_status: person.life_status,
      visibility: person.visibility,
      privacy_redacted: 'private',
      can_edit: false
    };
  }
  if (person.life_status === 'living' && role === 'viewer' && Number(person.created_by_user_id) !== Number(userId)) {
    return {
      ...person,
      maiden_name: '',
      birth_date: birthYear(person.birth_date),
      birth_place: null,
      photo_url: null,
      notes: null,
      privacy_redacted: 'living_limited',
      can_edit: false
    };
  }
  return { ...person, privacy_redacted: null, can_edit: canEdit(person, userId, role) };
}

function serializePeople(people, userId, role) {
  return people.map((person) => serializePerson(person, userId, role)).filter(Boolean);
}

module.exports = {
  ready,
  ROLE_LEVEL,
  validatePrivacy,
  canViewFull,
  canEdit,
  serializePerson,
  serializePeople
};
