const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeTestEnvironment, assertSucceeds } = require('@firebase/rules-unit-testing');

let env;
test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'family-tree-a4c4f', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
  await env.withSecurityRulesDisabled(async context => context.firestore().doc('users/graph-owner').set({ accountStatus: 'approved' }));
});
test.after(async () => env?.cleanup());

test('three-generation graph persists and edges can be removed safely', async () => {
  const db = env.authenticatedContext('graph-owner').firestore();
  await assertSucceeds(db.doc('trees/t1').set({ ownerUid: 'graph-owner', name: 'Lineage' }));
  await assertSucceeds(db.doc('trees/t1/members/graph-owner').set({ role: 'owner' }));
  const people = [
    ['grandparent', 'Grandparent'], ['parent', 'Parent'], ['child', 'Child'], ['spouse', 'Spouse'],
  ];
  for (const [id, firstName] of people) await assertSucceeds(db.doc(`trees/t1/persons/${id}`).set({ firstName, treeId: 't1' }));
  await assertSucceeds(db.doc('trees/t1/relationships/r-parent').set({ person1Id: 'grandparent', person2Id: 'parent', type: 'parent' }));
  await assertSucceeds(db.doc('trees/t1/relationships/r-child').set({ person1Id: 'parent', person2Id: 'child', type: 'parent' }));
  await assertSucceeds(db.doc('trees/t1/relationships/r-spouse').set({ person1Id: 'parent', person2Id: 'spouse', type: 'spouse' }));
  const reload = env.authenticatedContext('graph-owner').firestore();
  const snapshot = await assertSucceeds(reload.collection('trees/t1/persons').get());
  const edges = await assertSucceeds(reload.collection('trees/t1/relationships').get());
  assert.equal(snapshot.size, 4); assert.equal(edges.size, 3);
  await assertSucceeds(reload.doc('trees/t1/relationships/r-spouse').delete());
  assert.equal((await reload.collection('trees/t1/relationships').get()).size, 2);
});
