const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'family-sharing-test-secret';

const { app } = require('../server');
const db = require('../db');
const familyAccess = require('../family-access');

const password = 'correct-horse-battery-staple';
const unique = Date.now();
const ownerEmail = `owner-${unique}@example.test`;
const viewerEmail = `viewer-${unique}@example.test`;
const contributorEmail = `contributor-${unique}@example.test`;

async function signup(agent, body) {
  return agent.post('/api/auth/signup').send({ password, ...body });
}

test('family invitations provide isolated accounts with enforced roles', async (t) => {
  await Promise.all([db.ready, familyAccess.ready]);
  t.after(async () => db.pool.end());

  const owner = request.agent(app);
  const ownerSignup = await signup(owner, { email: ownerEmail, family_name: 'Test Lineage' });
  assert.equal(ownerSignup.status, 201, ownerSignup.text);
  assert.equal(ownerSignup.body.active_family_role, 'owner');
  const originalFamilyId = ownerSignup.body.active_family_id;

  const firstPerson = await owner.post('/api/persons').send({ first_name: 'Amina', last_name: 'Test' });
  assert.equal(firstPerson.status, 201, firstPerson.text);
  assert.equal(firstPerson.body.family_id, originalFamilyId);

  const viewerInvite = await owner.post('/api/family/invitations').send({ email: viewerEmail, role: 'viewer' });
  assert.equal(viewerInvite.status, 201, viewerInvite.text);
  assert.ok(viewerInvite.body.invite_token);

  const viewer = request.agent(app);
  const viewerSignup = await signup(viewer, {
    email: viewerEmail,
    invite_token: viewerInvite.body.invite_token
  });
  assert.equal(viewerSignup.status, 201, viewerSignup.text);
  assert.equal(viewerSignup.body.active_family_role, 'viewer');

  const viewerTree = await viewer.get('/api/tree');
  assert.equal(viewerTree.status, 200, viewerTree.text);
  assert.equal(viewerTree.body.persons.length, 1);
  assert.equal(viewerTree.body.persons[0].first_name, 'Amina');

  const viewerWrite = await viewer.post('/api/persons').send({ first_name: 'Blocked' });
  assert.equal(viewerWrite.status, 403, viewerWrite.text);
  const viewerRename = await viewer.put('/api/tree').send({ name: 'Blocked rename' });
  assert.equal(viewerRename.status, 403, viewerRename.text);

  const contributorInvite = await owner.post('/api/family/invitations').send({
    email: contributorEmail,
    role: 'contributor'
  });
  assert.equal(contributorInvite.status, 201, contributorInvite.text);

  const contributor = request.agent(app);
  const contributorSignup = await signup(contributor, {
    email: contributorEmail,
    invite_token: contributorInvite.body.invite_token
  });
  assert.equal(contributorSignup.status, 201, contributorSignup.text);
  assert.equal(contributorSignup.body.active_family_role, 'contributor');

  const contributorWrite = await contributor.post('/api/persons').send({ first_name: 'Kamau', last_name: 'Test' });
  assert.equal(contributorWrite.status, 201, contributorWrite.text);
  assert.equal(contributorWrite.body.family_id, originalFamilyId);

  const contributorRename = await contributor.put('/api/tree').send({ name: 'Blocked rename' });
  assert.equal(contributorRename.status, 403, contributorRename.text);

  const members = await owner.get('/api/family/members');
  assert.equal(members.status, 200, members.text);
  assert.deepEqual(
    new Set(members.body.members.map((member) => member.role)),
    new Set(['owner', 'viewer', 'contributor'])
  );

  const secondFamily = await owner.post('/api/families').send({ name: 'Second Tree' });
  assert.equal(secondFamily.status, 201, secondFamily.text);
  assert.notEqual(secondFamily.body.family.id, originalFamilyId);
  const emptySecondTree = await owner.get('/api/tree');
  assert.equal(emptySecondTree.body.persons.length, 0);

  const selectOriginal = await owner.post(`/api/families/${originalFamilyId}/select`);
  assert.equal(selectOriginal.status, 200, selectOriginal.text);
  const originalTree = await owner.get('/api/tree');
  assert.equal(originalTree.body.persons.length, 2);

  const renamed = await owner.put('/api/tree').send({ name: 'Renamed Test Lineage' });
  assert.equal(renamed.status, 200, renamed.text);
  assert.equal(renamed.body.name, 'Renamed Test Lineage');
});