const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'family-sharing-test-secret';
process.env.ACCOUNT_UNLOCK_FEE_KES = '500';
process.env.MPESA_PAYMENT_PHONE = '254113245740';
const mediaTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lineage-media-test-'));
process.env.MEDIA_LOCAL_DIR = mediaTestDir;

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
const privacyAccess = require('../privacy-access');
const archiveAccess = require('../archive-access');
const explorationAccess = require('../exploration-access');

async function signup(agent, body) {
  return agent.post('/api/auth/signup').send({ password, ...body });
}

async function approve(superadmin, userId) {
  return superadmin.patch(`/api/superadmin/accounts/${userId}/approve`).send({});
}

test('payment approval gates shared-family access and roles', async (t) => {
  await Promise.all([db.ready, familyAccess.ready, platformAccess.ready, privacyAccess.ready, archiveAccess.ready, explorationAccess.ready]);
  t.after(async () => {
    await db.pool.end();
    fs.rmSync(mediaTestDir, { recursive: true, force: true });
  });

  const anonymousSession = await request(app).get('/api/auth/session');
  assert.equal(anonymousSession.status, 200, anonymousSession.text);
  assert.deepEqual(anonymousSession.body, { authenticated: false });
  const protectedMe = await request(app).get('/api/auth/me');
  assert.equal(protectedMe.status, 401, protectedMe.text);

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
  const ownerSession = await owner.get('/api/auth/session');
  assert.equal(ownerSession.status, 200, ownerSession.text);
  assert.equal(ownerSession.body.authenticated, true);
  assert.equal(ownerSession.body.context.id, ownerSignup.body.id);
  assert.equal(ownerSignup.body.active_family_role, 'owner');
  const originalFamilyId = ownerSignup.body.active_family_id;

  const firstPerson = await owner.post('/api/persons').send({ first_name: 'Amina', last_name: 'Test' });
  assert.equal(firstPerson.status, 201, firstPerson.text);
  const mediaUpload = await owner.post('/api/upload')
    .attach('photo', Buffer.from('test-image-data'), { filename: 'portrait.png', contentType: 'image/png' });
  assert.equal(mediaUpload.status, 200, mediaUpload.text);
  assert.match(mediaUpload.body.url, /^\/api\/media\/[0-9a-f-]+$/);
  const mediaRead = await owner.get(mediaUpload.body.url);
  assert.equal(mediaRead.status, 200, mediaRead.text);
  assert.equal(mediaRead.headers['content-type'], 'image/png');

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
  assert.equal(viewerSignup.body.email_verified_at, null);

  const unverifiedTree = await viewer.get('/api/tree');
  assert.equal(unverifiedTree.status, 403, unverifiedTree.text);
  assert.equal(unverifiedTree.body.code, 'EMAIL_UNVERIFIED');
  const verified = await viewer.post('/api/auth/verify-email').send({
    token: viewerSignup.body.test_verification_token
  });
  assert.equal(verified.status, 200, verified.text);

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
  const contributorVerified = await contributor.post('/api/auth/verify-email').send({
    token: contributorSignup.body.test_verification_token
  });
  assert.equal(contributorVerified.status, 200, contributorVerified.text);

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

  const livingPrivateDetails = await owner.post('/api/persons').send({
    first_name: 'Nia',
    last_name: 'Protected',
    birth_date: '1994-06-18',
    birth_place: 'Nairobi',
    maiden_name: 'Sensitive',
    notes: 'Private family note',
    life_status: 'living',
    visibility: 'family'
  });
  assert.equal(livingPrivateDetails.status, 201, livingPrivateDetails.text);
  const ownerOnly = await owner.post('/api/persons').send({
    first_name: 'Hidden',
    last_name: 'Relative',
    notes: 'Creator only',
    life_status: 'living',
    visibility: 'private'
  });
  assert.equal(ownerOnly.status, 201, ownerOnly.text);

  const privacyTree = await viewer.get('/api/tree');
  const limited = privacyTree.body.persons.find((person) => person.id === livingPrivateDetails.body.id);
  assert.equal(limited.privacy_redacted, 'living_limited');
  assert.equal(limited.birth_date, '1994');
  assert.equal(limited.birth_place, null);
  assert.equal(limited.maiden_name, '');
  assert.equal(limited.notes, null);
  assert.equal(limited.can_edit, false);
  const placeholder = privacyTree.body.persons.find((person) => person.id === ownerOnly.body.id);
  assert.equal(placeholder.first_name, 'Private');
  assert.equal(placeholder.privacy_redacted, 'private');
  assert.equal(placeholder.notes, undefined);

  const privateEdit = await contributor.put(`/api/persons/${ownerOnly.body.id}`).send({ notes: 'Leaked edit' });
  assert.equal(privateEdit.status, 403, privateEdit.text);

  const sensitiveMedia = await owner.post('/api/upload')
    .attach('photo', Buffer.from('sensitive-image-data'), { filename: 'private.png', contentType: 'image/png' });
  assert.equal(sensitiveMedia.status, 200, sensitiveMedia.text);
  const attachSensitiveMedia = await owner.put(`/api/persons/${livingPrivateDetails.body.id}`).send({
    photo_url: sensitiveMedia.body.url
  });
  assert.equal(attachSensitiveMedia.status, 200, attachSensitiveMedia.text);
  assert.equal((await owner.get(sensitiveMedia.body.url)).status, 200);
  assert.equal((await viewer.get(sensitiveMedia.body.url)).status, 404);

  const softDelete = await owner.delete(`/api/persons/${livingPrivateDetails.body.id}`).send({ reason: 'Test recovery' });
  assert.equal(softDelete.status, 200, softDelete.text);
  const afterDelete = await owner.get('/api/tree');
  assert.equal(afterDelete.body.persons.some((person) => person.id === livingPrivateDetails.body.id), false);
  assert.equal((await viewer.get('/api/recycle-bin/persons')).status, 403);
  const recycle = await owner.get('/api/recycle-bin/persons');
  assert.equal(recycle.status, 200, recycle.text);
  assert.equal(recycle.body.persons.find((person) => person.id === livingPrivateDetails.body.id).deletion_reason, 'Test recovery');
  const restore = await owner.post(`/api/recycle-bin/persons/${livingPrivateDetails.body.id}/restore`);
  assert.equal(restore.status, 200, restore.text);
  const afterRestore = await owner.get('/api/tree');
  assert.equal(afterRestore.body.persons.some((person) => person.id === livingPrivateDetails.body.id), true);

  const accountExport = await viewer.get('/api/account/data-export');
  assert.equal(accountExport.status, 200, accountExport.text);
  assert.equal(accountExport.body.account.email, viewerEmail);
  assert.equal(accountExport.body.contributed_people.some((person) => person.id === ownerOnly.body.id), false);

  const ancestor = await owner.post('/api/persons').send({
    first_name: 'Wanjiku',
    last_name: 'Archive',
    birth_date: '1932-01-01',
    death_date: '2008-04-02',
    life_status: 'deceased',
    visibility: 'family'
  });
  assert.equal(ancestor.status, 201, ancestor.text);

  const migrationEvent = await owner.post('/api/archive/events').send({
    person_id: ancestor.body.id,
    event_type: 'migration',
    title: 'Moved to Nairobi',
    event_date: '1958',
    place: 'Nairobi, Kenya',
    latitude: -1.286389,
    longitude: 36.817223,
    description: 'Started a new chapter for the family.',
    source_title: 'Recorded family interview',
    source_url: 'https://example.test/family-interview',
    visibility: 'family'
  });
  assert.equal(migrationEvent.status, 201, migrationEvent.text);
  assert.equal(migrationEvent.body.person_name, 'Wanjiku Archive');
  assert.equal(Number(migrationEvent.body.latitude), -1.286389);
  assert.equal(Number(migrationEvent.body.longitude), 36.817223);

  const livingEvent = await owner.post('/api/archive/events').send({
    person_id: livingPrivateDetails.body.id,
    event_type: 'education',
    title: 'Graduated from university',
    event_date: '2015',
    description: 'Sensitive living-person detail',
    visibility: 'family'
  });
  assert.equal(livingEvent.status, 201, livingEvent.text);

  const viewerEvents = await viewer.get('/api/archive/events');
  assert.equal(viewerEvents.status, 200, viewerEvents.text);
  assert.ok(viewerEvents.body.events.some((event) => event.id === migrationEvent.body.id));
  assert.equal(viewerEvents.body.events.some((event) => event.id === livingEvent.body.id), false);
  const contributorPrivateEvent = await contributor.post('/api/archive/events').send({
    person_id: ownerOnly.body.id,
    event_type: 'other',
    title: 'Should be blocked'
  });
  assert.equal(contributorPrivateEvent.status, 403, contributorPrivateEvent.text);

  const familyStory = await owner.post('/api/archive/stories').send({
    title: 'The journey to the city',
    body: 'Wanjiku arrived with one suitcase and the address of a cousin. The family still tells the story of that first evening.',
    story_date: '1958',
    place: 'Nairobi',
    visibility: 'family',
    person_ids: [ancestor.body.id]
  });
  assert.equal(familyStory.status, 201, familyStory.text);
  assert.equal(familyStory.body.people[0].id, ancestor.body.id);

  const sensitiveStory = await owner.post('/api/archive/stories').send({
    title: 'A living memory',
    body: 'This story must inherit the living person privacy boundary.',
    story_date: '2020',
    visibility: 'family',
    person_ids: [livingPrivateDetails.body.id]
  });
  assert.equal(sensitiveStory.status, 201, sensitiveStory.text);

  const viewerStories = await viewer.get('/api/archive/stories');
  assert.equal(viewerStories.status, 200, viewerStories.text);
  assert.ok(viewerStories.body.stories.some((story) => story.id === familyStory.body.id));
  assert.equal(viewerStories.body.stories.some((story) => story.id === sensitiveStory.body.id), false);
  const blockedStoryEdit = await contributor.put(`/api/archive/stories/${familyStory.body.id}`).send({
    title: 'Unauthorized rewrite',
    body: familyStory.body.body,
    visibility: 'family',
    person_ids: [ancestor.body.id]
  });
  assert.equal(blockedStoryEdit.status, 403, blockedStoryEdit.text);

  const viewerComment = await viewer.post(`/api/archive/stories/${familyStory.body.id}/comments`).send({
    body: 'I remember hearing this from my grandmother.'
  });
  assert.equal(viewerComment.status, 201, viewerComment.text);
  const storyReader = await viewer.get(`/api/archive/stories/${familyStory.body.id}`);
  assert.equal(storyReader.status, 200, storyReader.text);
  assert.equal(storyReader.body.comments.length, 1);
  const hiddenStoryReader = await viewer.get(`/api/archive/stories/${sensitiveStory.body.id}`);
  assert.equal(hiddenStoryReader.status, 404, hiddenStoryReader.text);

  const archiveOverview = await viewer.get('/api/archive/overview');
  assert.equal(archiveOverview.status, 200, archiveOverview.text);
  assert.equal(archiveOverview.body.stats.events, 1);
  assert.equal(archiveOverview.body.stats.stories, 1);
  const archiveExport = await viewer.get('/api/archive/export');
  assert.equal(archiveExport.status, 200, archiveExport.text);
  assert.equal(archiveExport.body.events.some((event) => event.id === livingEvent.body.id), false);
  assert.equal(archiveExport.body.stories.some((story) => story.id === sensitiveStory.body.id), false);

  const parentRelationship = await owner.post('/api/relationships').send({
    type: 'parent',
    person1_id: ancestor.body.id,
    person2_id: firstPerson.body.id
  });
  assert.equal(parentRelationship.status, 201, parentRelationship.text);

  const descendantSlice = await owner.get(`/api/exploration/tree-slice?focus_id=${ancestor.body.id}&direction=descendants&depth=2`);
  assert.equal(descendantSlice.status, 200, descendantSlice.text);
  assert.deepEqual(
    new Set(descendantSlice.body.persons.map((person) => person.id)),
    new Set([ancestor.body.id, firstPerson.body.id])
  );
  assert.equal(descendantSlice.body.slice.total_people, 5);

  const viewerShareList = await viewer.get('/api/exploration/share-links');
  assert.equal(viewerShareList.status, 403, viewerShareList.text);

  const safeShare = await owner.post('/api/exploration/share-links').send({
    label: 'Reunion ancestors',
    view: 'pedigree',
    focus_person_id: firstPerson.body.id,
    generation_depth: 4,
    expiry_hours: 24,
    include_living: false
  });
  assert.equal(safeShare.status, 201, safeShare.text);
  assert.match(safeShare.body.url, /\?share=/);
  const safeToken = new URL(safeShare.body.url).searchParams.get('share');
  assert.ok(safeToken);
  const storedToken = await db.query('SELECT token_hash FROM family_share_links WHERE id = $1', [safeShare.body.link.id]);
  assert.equal(storedToken.rows[0].token_hash, explorationAccess.hashToken(safeToken));
  assert.notEqual(storedToken.rows[0].token_hash, safeToken);

  const publicSafeTree = await request(app).get(`/api/shared-tree/${encodeURIComponent(safeToken)}`);
  assert.equal(publicSafeTree.status, 200, publicSafeTree.text);
  assert.equal(publicSafeTree.headers['cache-control'], 'private, no-store');
  assert.equal(publicSafeTree.body.tree.id, undefined);
  assert.equal(publicSafeTree.body.persons[0].family_id, undefined);
  assert.equal(publicSafeTree.body.persons.some((person) => person.life_status === 'living'), false);
  assert.equal(publicSafeTree.body.persons.some((person) => person.id === ownerOnly.body.id), false);

  const livingShare = await owner.post('/api/exploration/share-links').send({
    label: 'Living relatives preview',
    view: 'family',
    generation_depth: 4,
    expiry_hours: 24,
    include_living: true
  });
  assert.equal(livingShare.status, 201, livingShare.text);
  const livingToken = new URL(livingShare.body.url).searchParams.get('share');
  const publicLivingTree = await request(app).get(`/api/shared-tree/${encodeURIComponent(livingToken)}`);
  assert.equal(publicLivingTree.status, 200, publicLivingTree.text);
  const publicLimited = publicLivingTree.body.persons.find((person) => person.id === livingPrivateDetails.body.id);
  assert.equal(publicLimited.privacy_redacted, 'living_limited');
  assert.equal(publicLimited.birth_date, '1994');
  assert.equal(publicLivingTree.body.persons.some((person) => person.id === ownerOnly.body.id), false);
  assert.ok(publicLivingTree.body.relationships.length > 0);
  assert.equal(publicLivingTree.body.relationships[0].created_by_user_id, undefined);

  const chartPdf = await owner.get(`/api/exploration/chart.pdf?view=descendants&focus_id=${ancestor.body.id}&depth=3`);
  assert.equal(chartPdf.status, 200, chartPdf.text);
  assert.match(chartPdf.headers['content-type'], /^application\/pdf/);
  assert.ok(chartPdf.body.length > 1000);

  const shareList = await owner.get('/api/exploration/share-links');
  assert.equal(shareList.status, 200, shareList.text);
  assert.ok(shareList.body.links.some((link) => link.id === safeShare.body.link.id));
  const revokeShare = await owner.delete(`/api/exploration/share-links/${safeShare.body.link.id}`);
  assert.equal(revokeShare.status, 200, revokeShare.text);
  const revokedTree = await request(app).get(`/api/shared-tree/${encodeURIComponent(safeToken)}`);
  assert.equal(revokedTree.status, 404, revokedTree.text);

  const members = await owner.get('/api/family/members');
  assert.equal(members.status, 200, members.text);
  assert.deepEqual(new Set(members.body.members.map((member) => member.role)), new Set(['owner', 'viewer', 'contributor']));

  const secondFamily = await owner.post('/api/families').send({ name: 'Second Tree' });
  assert.equal(secondFamily.status, 201, secondFamily.text);
  const emptySecondTree = await owner.get('/api/tree');
  assert.equal(emptySecondTree.body.persons.length, 0);
  await owner.post(`/api/families/${originalFamilyId}/select`);
  const originalTree = await owner.get('/api/tree');
  assert.equal(originalTree.body.persons.length, 5);

  const audit = await owner.get('/api/family/audit');
  assert.equal(audit.status, 200, audit.text);
  assert.ok(audit.body.entries.some((entry) => entry.action === 'person.created'));

  const unknownReset = await request(app).post('/api/auth/request-password-reset').send({
    email: `missing-${unique}@example.test`
  });
  assert.equal(unknownReset.status, 200, unknownReset.text);
  assert.doesNotMatch(unknownReset.text, /not found/i);

  const resetRequest = await request(app).post('/api/auth/request-password-reset').send({ email: viewerEmail });
  assert.equal(resetRequest.status, 200, resetRequest.text);
  assert.ok(resetRequest.body.test_token);
  const newPassword = 'new-correct-horse-battery-staple';
  const reset = await request(app).post('/api/auth/reset-password').send({
    token: resetRequest.body.test_token,
    new_password: newPassword
  });
  assert.equal(reset.status, 200, reset.text);
  const reusedReset = await request(app).post('/api/auth/reset-password').send({
    token: resetRequest.body.test_token,
    new_password: newPassword
  });
  assert.equal(reusedReset.status, 400, reusedReset.text);
  const oldPasswordLogin = await request(app).post('/api/auth/login').send({ email: viewerEmail, password });
  assert.equal(oldPasswordLogin.status, 401, oldPasswordLogin.text);
  const viewerAfterReset = request.agent(app);
  const newPasswordLogin = await viewerAfterReset.post('/api/auth/login').send({ email: viewerEmail, password: newPassword });
  assert.equal(newPasswordLogin.status, 200, newPasswordLogin.text);

  const deleteContributor = await contributor.delete('/api/account').send({
    password,
    confirmation: 'DELETE MY ACCOUNT'
  });
  assert.equal(deleteContributor.status, 200, deleteContributor.text);
  const deletedLogin = await request(app).post('/api/auth/login').send({ email: contributorEmail, password });
  assert.equal(deletedLogin.status, 401, deletedLogin.text);
  await owner.post(`/api/families/${originalFamilyId}/select`);
  const preservedSharedRecords = await owner.get('/api/tree');
  assert.ok(preservedSharedRecords.body.persons.some((person) => person.id === contributorWrite.body.id));

  const transferOwnership = await owner.patch('/api/family/owner').send({ user_id: viewerSignup.body.id });
  assert.equal(transferOwnership.status, 200, transferOwnership.text);
  const previousOwnerContext = await owner.get('/api/auth/me');
  assert.equal(previousOwnerContext.body.active_family_role, 'admin');
  const newOwnerContext = await viewerAfterReset.get('/api/auth/me');
  assert.equal(newOwnerContext.body.active_family_role, 'owner');
});
