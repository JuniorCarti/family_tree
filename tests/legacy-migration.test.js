const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'legacy-migration-test-secret';

const databaseUrl = new URL(process.env.DATABASE_URL || '');
if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) || !databaseUrl.pathname.toLowerCase().includes('test')) {
  throw new Error('Legacy migration test refuses to reset a database unless it is local and its name contains "test"');
}

async function seedLegacySchema() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
  const passwordHash = await bcrypt.hash('legacy-password', 4);
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await pool.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        family_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT now()
      );
      CREATE TABLE persons (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255) DEFAULT '',
        maiden_name VARCHAR(255) DEFAULT '',
        gender VARCHAR(50) CHECK (gender IN ('male','female','other','unknown')) DEFAULT 'unknown',
        birth_date VARCHAR(50),
        death_date VARCHAR(50),
        birth_place VARCHAR(255),
        photo_url TEXT,
        notes TEXT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      );
      CREATE TABLE relationships (
        id SERIAL PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        person1_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
        person2_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
        label VARCHAR(255),
        status VARCHAR(50) DEFAULT 'married',
        start_date VARCHAR(50),
        end_date VARCHAR(50),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(type, person1_id, person2_id)
      )
    `);
    const user = await pool.query(
      'INSERT INTO users (email, password_hash, family_name) VALUES ($1, $2, $3) RETURNING id',
      ['legacy-owner@example.test', passwordHash, 'Legacy Lineage']
    );
    const first = await pool.query(
      'INSERT INTO persons (first_name, last_name, user_id) VALUES ($1, $2, $3) RETURNING id',
      ['First', 'Ancestor', user.rows[0].id]
    );
    const second = await pool.query(
      'INSERT INTO persons (first_name, last_name, user_id) VALUES ($1, $2, $3) RETURNING id',
      ['Second', 'Ancestor', user.rows[0].id]
    );
    await pool.query(
      "INSERT INTO relationships (type, person1_id, person2_id, user_id) VALUES ('parent', $1, $2, $3)",
      [first.rows[0].id, second.rows[0].id, user.rows[0].id]
    );
  } finally {
    await pool.end();
  }
}

test('legacy account-owned lineage migrates intact into an owner family', async () => {
  await seedLegacySchema();

  const db = require('../db');
  const familyAccess = require('../family-access');
  const platformAccess = require('../platform-access');
  const memoryAccess = require('../memory-access');
  try {
    await Promise.all([db.ready, familyAccess.ready, platformAccess.ready, memoryAccess.ready]);

    const family = await db.query(`
      SELECT f.id, f.name, f.owner_user_id, fm.role
      FROM families f
      JOIN family_memberships fm ON fm.family_id = f.id
      JOIN users u ON u.id = fm.user_id
      WHERE u.email = 'legacy-owner@example.test'
    `);
    assert.equal(family.rows.length, 1);
    assert.equal(family.rows[0].name, 'Legacy Lineage');
    assert.equal(family.rows[0].role, 'owner');

    const legacyAccess = await platformAccess.getAccountAccess(family.rows[0].owner_user_id);
    assert.equal(legacyAccess.account_status, 'approved');
    assert.equal(legacyAccess.is_superadmin, false);

    const people = await db.query('SELECT first_name, family_id, created_by_user_id FROM persons ORDER BY id');
    assert.equal(people.rows.length, 2);
    assert.ok(people.rows.every((person) => person.family_id === family.rows[0].id));
    assert.ok(people.rows.every((person) => person.created_by_user_id === family.rows[0].owner_user_id));

    const relationships = await db.query('SELECT type, family_id, created_by_user_id FROM relationships');
    assert.equal(relationships.rows.length, 1);
    assert.equal(relationships.rows[0].type, 'parent');
    assert.equal(relationships.rows[0].family_id, family.rows[0].id);
    assert.equal(relationships.rows[0].created_by_user_id, family.rows[0].owner_user_id);

    const requiredColumns = await db.query(`
      SELECT table_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('persons', 'relationships')
        AND column_name = 'family_id'
      ORDER BY table_name
    `);
    assert.deepEqual(requiredColumns.rows.map((row) => row.is_nullable), ['NO', 'NO']);
  } finally {
    await db.pool.end();
  }
});
