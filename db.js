require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ---------------------------------------------------------------------------
    // Schema definition for Postgres
    // ---------------------------------------------------------------------------

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        family_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS persons (
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
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS relationships (
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

    await client.query(`CREATE INDEX IF NOT EXISTS idx_rel_person1 ON relationships(person1_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_rel_person2 ON relationships(person2_id)`);

    await client.query('COMMIT');
    console.log('Database initialized successfully context: Postgres schema created/verified.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during database initialization:', err);
    throw err;
  } finally {
    client.release();
  }

  // ---------------------------------------------------------------------------
  // Post-init: migrate the type constraint outside any transaction so DDL
  // doesn't abort the main setup block. Each statement is its own operation.
  // ---------------------------------------------------------------------------
  try {
    await pool.query(`ALTER TABLE relationships DROP CONSTRAINT IF EXISTS relationships_type_check`);
    await pool.query(`
      ALTER TABLE relationships ADD CONSTRAINT relationships_type_check
        CHECK (type IN ('parent','spouse','relative','sibling','grandparent','grandchild','aunt_uncle','niece_nephew','cousin'))
        NOT VALID
    `);
    console.log('Relationship type constraint updated.');
  } catch (err) {
    // Constraint may already be correct on a fresh DB or managed service — non-fatal
    console.warn('Skipped constraint update (non-fatal):', err.message);
  }
}

// Expose initialization so dependent migrations can run in a deterministic order.
const ready = initDB().catch(err => {
  console.error('Failed to init DB:', err);
  throw err;
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  ready,
};
