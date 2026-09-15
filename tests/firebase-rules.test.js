const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');

let env;
test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'family-tree-a4c4f',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
    storage: { rules: fs.readFileSync('storage.rules', 'utf8') },
  });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc('users/user-a').set({ accountStatus: 'approved' });
    await db.doc('users/user-b').set({ accountStatus: 'approved' });
    await db.doc('trees/tree-a').set({ ownerUid: 'user-a', name: 'A' });
    await db.doc('trees/tree-a/members/user-a').set({ role: 'owner' });
    await db.doc('trees/tree-b').set({ ownerUid: 'user-b', name: 'B' });
    await db.doc('trees/tree-b/members/user-b').set({ role: 'owner' });
  });
});

test.after(async () => { if (env) await env.cleanup(); });

test('owner can read and write their tree while another user is denied', async () => {
  const a = env.authenticatedContext('user-a').firestore();
  const b = env.authenticatedContext('user-b').firestore();
  await assertSucceeds(a.doc('trees/tree-a/persons/p1').set({ firstName: 'A' }));
  await assertSucceeds(a.doc('trees/tree-a/persons/p1').get());
  await assertFails(b.doc('trees/tree-a/persons/p1').get());
  await assertFails(b.doc('trees/tree-a/persons/p1').set({ firstName: 'intruder' }));
  await assertFails(a.doc('trees/tree-b/relationships/r1').set({ person1Id: 'x', person2Id: 'y' }));
});

test('anonymous users cannot access private trees', async () => {
  const anon = env.unauthenticatedContext().firestore();
  await assertFails(anon.doc('trees/tree-a').get());
  await assertFails(anon.doc('trees/tree-a/persons/p2').set({ firstName: 'x' }));
});

test('storage requires same-user tree membership and image constraints', async () => {
  const a = env.authenticatedContext('user-a').storage();
  const b = env.authenticatedContext('user-b').storage();
  const anon = env.unauthenticatedContext().storage();
  await assertSucceeds(a.ref('users/user-a/trees/tree-a/persons/p1/profile.png').putString('png', 'raw', { contentType: 'image/png' }));
  await assertFails(b.ref('users/user-a/trees/tree-a/persons/p1/profile.png').getMetadata());
  await assertFails(a.ref('users/user-a/trees/tree-b/persons/p1/profile.png').putString('png', 'raw', { contentType: 'image/png' }));
  await assertFails(anon.ref('users/user-a/trees/tree-a/persons/p1/x.png').putString('png', 'raw', { contentType: 'image/png' }));
  await assertFails(a.ref('users/user-a/trees/tree-a/persons/p1/x.txt').putString('text', 'raw', { contentType: 'text/plain' }));
});
