#!/usr/bin/env node
/* Safe user import scaffold. It never writes unless --execute is supplied. */
const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

const execute = process.argv.includes('--execute');
const source = process.argv.find(a => a.startsWith('--source='))?.slice(9);
if (!source) { console.error('Usage: node scripts/migrate-to-firebase/import-users.js --source=users.json [--dry-run|--execute]'); process.exit(2); }
const users = JSON.parse(fs.readFileSync(path.resolve(source), 'utf8'));
if (!Array.isArray(users)) throw new Error('Source must be a JSON array');
const seen = new Set();
for (const u of users) {
  if (!u.email || !u.passwordHash) throw new Error('Each user needs email and passwordHash for BCRYPT import');
  const email = String(u.email).trim().toLowerCase();
  if (seen.has(email)) throw new Error(`Duplicate email in source: ${email}`);
  seen.add(email);
}
console.log(JSON.stringify({ mode: execute ? 'execute' : 'dry-run', users: users.length, bcryptHashes: users.length, writes: execute ? users.length : 0 }));
if (!execute) process.exit(0);
if (!admin.apps.length) admin.initializeApp();
(async () => {
  for (const u of users) {
    const uid = u.uid || `legacy_${u.legacyUserId}`;
    await admin.auth().importUsers([{ uid, email: u.email, passwordHash: Buffer.from(u.passwordHash, 'base64'), displayName: u.familyName || undefined, emailVerified: Boolean(u.emailVerified), disabled: Boolean(u.disabled) }], { hash: { algorithm: 'BCRYPT' } });
  }
})().catch(err => { console.error(`user import failed: ${err.code || err.message}`); process.exit(1); });
