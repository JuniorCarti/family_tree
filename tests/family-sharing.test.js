const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'family-sharing-test-secret';
process.env.ACCOUNT_UNLOCK_FEE_KES = '500';
process.env.MPESA_PAYMENT_PHONE = '254113245740';

const password = 'correct-horse-battery-staple';
const unique = Date.now();
const suffix = String(unique).slice(-6);
const ownerEmail = `owner-${unique}@example.test`;
const viewerEmail = `viewer-${unique}@example.test`;
const contributorEmail = `contributor-${unique}@example.test`;
process.env.SUPERADMIN_EMAILS = ownerEmail;

const { app } = require('../server');
const db = require('../db');
const familyAccess = require('../family-access');
const platformAccess = require('../platform-access');

async function signup(agent, body) {
  return agent.post('/api/auth/signup').send({ password, ...body });
}

async function approve(superadmin, userId) {
  return superadmin.patch(`/api/superadmin/accounts/${userId}/approve`).send({});
}

test('payment approval gates shared-family access and roles', async (t) => {
  await Promise.all([db.ready, familyAccess.ready, platformAccess.ready]);
  t.after(async () => db.pool.end());

  const shell = await request(app).get('/');
  assert.equal(shell.status, 200, shell.text);
  assert.match(shell.text, /Unlock your family archive/);
  assert.match(shell.text, /254113245740/);
  assert.match(shell.text, /Lineage will never ask for your M-Pesa PIN/);
  assert.match(shell.text, /class="auth-scene"/);
  assert.match(shell.text, /class="modal auth-card"/);
  assert.match(shell.text, /id="authSubtitle"/);
  assert.match(shell.text, /id="superadminModalOverlay"/);
  assert.match(shell.text, /id="logoutBtn"/);

  const owner = request.agent(app);
  const ownerSignup = await signup(owner, { email: ownerEmail, family_name: 'Test Lineage' });
  assert.equal(ownerSignup.status, 201, ownerSignup.text);
  assert.equal(ownerSignup.body.account_status, 'approved');
  assert.equal(ownerSignup.body.is_superadmin, true);
  assert.equal(ownerSignup.body.active_family_role, 'owner');
  const originalFamilyId = ownerSignup.body.active_family_id;

  const firstPerson = await owner.post('/api/persons').send({ first_name: 'Amina', last_name: 'Test' });
  assert.equal(firstPerson.status, 201, firstPerson.text);

  const viewerInvite = await owner.post('/api/family/invitations').send({ email: viewerEmail, role: 'viewer' });
  assert.equal(viewerInvite.status, 201, viewerInvite.text);

  const viewer = request.agent(app);
  const viewerSignup = await signup(viewer, {
    email: viewerEmail,
    invite_token: viewerInvite.body.invite_token
  });
  assert.equal(viewerSignup.status, 201, viewerSignup.text);
  assert.equal(viewerSignup.body.account_status, 'pending');
  assert.equal(viewerSignup.body.active_family_role, 'viewer');

  const lockedTree = await viewer.get('/api/tree');
  assert.equal(lockedTree.status, 403, lockedTree.text);
  assert.equal(lockedTree.body.code, 'ACCOUNT_LOCKED');

  const access = await viewer.get('/api/account/access');
  assert.equal(access.status, 200, access.text);
  assert.equal(access.body.access.unlock_fee_kes, 500);
  assert.equal(access.body.access.payment_phone, '254113245740');

  const invalidProof = await viewer.post('/api/account/payment-submissions').send({ mpesa_reference: 'short' });
  assert.equal(invalidProof.status, 400, invalidProof.text);
  const viewerReference = `VIEW${suffix}`;
  const viewerProof = await viewer.post('/api/account/payment-submissions').send({
    mpesa_reference: viewerReference,
    payer_phone: '0712345678'
  });
  assert.equal(viewerProof.status, 201, viewerProof.text);

  const waitingAccess = await viewer.get('/api/account/access');
  assert.equal(waitingAccess.body.access.account_status, 'payment_submitted');
  assert.equal(waitingAccess.body.access.mpesa_reference, viewerReference);
  assert.equal(waitingAccess.body.access.payer_phone, '254712345678');

  const queue = await owner.get('/api/superadmin/accounts?status=payment_submitted');
  assert.equal(queue.status, 200, queue.text);
  const queuedViewer = queue.body.accounts.find((account) => account.email === viewerEmail);
  assert.ok(queuedViewer);
  assert.equal(queuedViewer.mpesa_reference, viewerReference);

  const viewerApproval = await approve(owner, viewerSignup.body.id);
  assert.equal(viewerApproval.status, 200, viewerApproval.text);
  const rejectApproved = await owner.patch(`/api/superadmin/accounts/${viewerSignup.body.id}/reject`).send({ reason: 'should not be allowed' });
  assert.equal(rejectApproved.status, 409, rejectApproved.text);
  const viewerTree = await viewer.get('/api/tree');
  assert.equal(viewerTree.status, 200, viewerTree.text);
  assert.equal(viewerTree.body.persons[0].first_name, 'Amina');

  const viewerWrite = await viewer.post('/api/persons').send({ first_name: 'Role blocked' });
  assert.equal(viewerWrite.status, 403, viewerWrite.text);

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
  assert.equal(contributorSignup.body.account_status, 'pending');

  const noPaymentApproval = await approve(owner, contributorSignup.body.id);
  assert.equal(noPaymentApproval.status, 409, noPaymentApproval.text);

  const reusedReference = await contributor.post('/api/account/payment-submissions').send({
    mpesa_reference: viewerReference
  });
  assert.equal(reusedReference.status, 409, reusedReference.text);

  const firstContributorReference = `CONT${suffix}`;
  const contributorProof = await contributor.post('/api/account/payment-submissions').send({
    mpesa_reference: firstContributorReference
  });
  assert.equal(contributorProof.status, 201, contributorProof.text);

  const rejected = await owner.patch(`/api/superadmin/accounts/${contributorSignup.body.id}/reject`).send({
    reason: 'Transaction was not found in the recipient statement'
  });
  assert.equal(rejected.status, 200, rejected.text);
  const rejectedAccess = await contributor.get('/api/account/access');
  assert.equal(rejectedAccess.body.access.account_status, 'rejected');
  assert.match(rejectedAccess.body.access.rejection_reason, /not found/);

  const secondContributorReference = `CNTR${suffix}`;
  const resubmitted = await contributor.post('/api/account/payment-submissions').send({
    mpesa_reference: secondContributorReference
  });
  assert.equal(resubmitted.status, 201, resubmitted.text);
  const contributorApproval = await approve(owner, contributorSignup.body.id);
  assert.equal(contributorApproval.status, 200, contributorApproval.text);

  const contributorWrite = await contributor.post('/api/persons').send({ first_name: 'Kamau', last_name: 'Test' });
  assert.equal(contributorWrite.status, 201, contributorWrite.text);
  assert.equal(contributorWrite.body.family_id, originalFamilyId);
  const contributorRename = await contributor.put('/api/tree').send({ name: 'Blocked rename' });
  assert.equal(contributorRename.status, 403, contributorRename.text);

  const members = await owner.get('/api/family/members');
  assert.equal(members.status, 200, members.text);
  assert.deepEqual(new Set(members.body.members.map((member) => member.role)), new Set(['owner', 'viewer', 'contributor']));

  const secondFamily = await owner.post('/api/families').send({ name: 'Second Tree' });
  assert.equal(secondFamily.status, 201, secondFamily.text);
  const emptySecondTree = await owner.get('/api/tree');
  assert.equal(emptySecondTree.body.persons.length, 0);
  await owner.post(`/api/families/${originalFamilyId}/select`);
  const originalTree = await owner.get('/api/tree');
  assert.equal(originalTree.body.persons.length, 2);
});