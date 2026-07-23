const Database = require('better-sqlite3');
const path = require('path');

async function test() {
    console.log('--- Database Verification ---');
    const db = require('./db');

    // Verify relationships table check constraints and schema
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='relationships'").get()?.sql;
    console.log('Current schema in DB:\n', schema);

    if (!schema.includes('sibling')) {
        throw new Error('Database SCHEMA does not contain "sibling" type constraint!');
    }

    // Clean up any test person rows
    db.prepare("DELETE FROM relationships WHERE status = 'test_run'").run();
    db.prepare("DELETE FROM persons WHERE notes = 'test_run_notes'").run();

    // Create test persons
    const p1 = db.prepare(`
    INSERT INTO persons (first_name, last_name, gender, notes)
    VALUES ('RootParent', 'Test', 'male', 'test_run_notes')
  `).run();
    const p1Id = p1.lastInsertRowid;

    const p2 = db.prepare(`
    INSERT INTO persons (first_name, last_name, gender, notes)
    VALUES ('RootChild', 'Test', 'female', 'test_run_notes')
  `).run();
    const p2Id = p2.lastInsertRowid;

    console.log(`Created test persons ID: ${p1Id} and ${p2Id}`);

    // Try creating new relationship types
    const types = ['sibling', 'grandparent', 'grandchild', 'cousin', 'relative'];
    for (const t of types) {
        try {
            db.prepare(`
        INSERT INTO relationships (type, person1_id, person2_id, status)
        VALUES (?, ?, ?, 'test_run')
      `).run(t, p1Id, p2Id);
            console.log(`Successfully created relationship type: "${t}"`);
            db.prepare("DELETE FROM relationships WHERE type = ? AND person1_id = ? AND person2_id = ?", t, p1Id, p2Id).run();
        } catch (e) {
            console.error(`FAILED to create relationship type: "${t}"`, e);
            throw e;
        }
    }

    // Clean up
    db.prepare("DELETE FROM persons WHERE notes = 'test_run_notes'").run();
    console.log('Database verification successfully PASSED!');
    process.exit(0);
}

test().catch(err => {
    console.error('Verification failed:', err);
    process.exit(1);
});
