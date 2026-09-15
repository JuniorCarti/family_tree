const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const firebase = fs.readFileSync('firebase.json', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');
const storage = fs.readFileSync('storage.rules', 'utf8');
const functions = fs.readFileSync('functions/src/index.js', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const client = fs.readFileSync('public/firebase-client.js', 'utf8');

test('Hosting routes API traffic to Firebase Functions, not Cloud Run', () => {
  const config = JSON.parse(firebase);
  const rewrite = config.hosting.rewrites.find(r => r.source === '/api/**');
  assert.deepEqual(rewrite.function, { functionId: 'api', region: 'us-central1' });
  assert.doesNotMatch(firebase, /lineage-api|run\.app|render\.com/);
});

test('Firestore rules require authentication and membership', () => {
  assert.match(rules, /request\.auth != null/);
  assert.match(rules, /members\/\$\(request\.auth\.uid\)/);
  assert.doesNotMatch(rules, /allow read, write: if true/);
});

test('Storage rules constrain identity, size, and image MIME type', () => {
  assert.match(storage, /request\.auth\.uid == uid/);
  assert.match(storage, /10 \* 1024 \* 1024/);
  assert.match(storage, /image\/\.\*/);
});

test('Functions verify bearer tokens and reject invalid graph writes', () => {
  assert.match(functions, /verifyIdToken/);
  assert.match(functions, /Bearer /);
  assert.match(functions, /person1Id === person2Id/);
  assert.match(functions, /Both people must exist in this tree/);
});

test('Fresh-launch auth contracts use Firebase logout, account access, and corrected phone OTP', () => {
  assert.match(functions, /\/api\/account\/access/);
  assert.match(functions, /\/api\/account\/payment-submissions/);
  assert.match(functions, /req\.user\?\.superadmin/);
  assert.match(app, /LineageFirebaseAuthApi\.signOut/);
  assert.match(app, /approvalLogoutBtn/);
  assert.match(app, /LineageFirebaseAuthApi\.signOut/);
  assert.match(client, /RecaptchaVerifier\(auth, container/);
});

test('Firebase API covers the archive routes loaded by the workspace', () => {
  for (const route of ['/api/archive/overview', '/api/archive/events', '/api/archive/stories', '/api/archive/stories/:id/comments']) {
    assert.match(functions, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Firebase API covers the remaining shipped workspace modules', () => {
  for (const route of [
    '/api/evidence/sources', '/api/evidence/citations',
    '/api/memories/overview', '/api/memories/items', '/api/memories/albums', '/api/memories/recipes', '/api/memories/memorials', '/api/memories/calendar',
    '/api/quality/findings', '/api/quality/scan', '/api/collaboration/overview', '/api/collaboration/tasks', '/api/collaboration/announcements',
    '/api/discovery/search', '/api/recycle-bin/persons', '/api/duplicates', '/api/merge'
  ]) assert.match(functions, new RegExp(route.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  assert.match(functions, /recycleBin/);
  assert.match(functions, /deletionReason/);
});

test('Email verification uses Firebase action settings and refreshed provider state', () => {
  assert.match(client, /sendEmailVerification\(auth\.currentUser,\s*\{\s*url:\s*'https:\/\/family-tree-a4c4f\.web\.app\//);
  assert.match(client, /auth\.currentUser\.reload\(\)/);
  assert.match(client, /getIdToken\(true\)/);
  assert.match(app, /providerId === 'password'/);
  assert.match(app, /LineageFirebaseAuthApi\.refresh/);
  assert.match(app, /LineageFirebaseAuthApi\.verifyEmail/);
});
