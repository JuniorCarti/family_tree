const express = require('express');
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket();
const app = express();
app.use(express.json({ limit: '1mb' }));
app.disable('x-powered-by');

async function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = await admin.auth().verifyIdToken(header.slice(7));
    next();
  } catch (err) {
    console.warn('firebase_auth_verify_failed', { code: err.code });
    return res.status(401).json({ error: 'Authentication required' });
  }
}

function treeRef(id) { return db.collection('trees').doc(String(id)); }
async function memberRole(treeId, uid) {
  const snap = await treeRef(treeId).collection('members').doc(uid).get();
  if (snap.exists) return snap.get('role');
  const tree = await treeRef(treeId).get();
  return tree.exists && tree.get('ownerUid') === uid ? 'owner' : null;
}
async function requireTree(req, res, next) {
  const id = req.params.treeId || req.query.treeId || req.body.treeId || req.get('x-tree-id');
  if (!id) {
    const own = await db.collection('trees').where('ownerUid', '==', req.user.uid).limit(1).get();
    if (own.empty) return res.status(404).json({ error: 'No family tree exists' });
    req.treeId = own.docs[0].id; req.role = 'owner'; return next();
  }
  const role = await memberRole(id, req.user.uid);
  if (!role) return res.status(403).json({ error: 'Tree access denied' });
  req.treeId = String(id); req.role = role; next();
}
function canWrite(role) { return ['owner', 'admin', 'contributor'].includes(role); }
async function profileFor(uid) { const snap = await db.collection('users').doc(uid).get(); return snap.exists ? snap.data() : {}; }
// Only Firebase Admin-issued claims authorize platform administration. A
// profile field is informational and must never grant privilege.
function isSuperadmin(req) { return Boolean(req.user?.superadmin === true || req.user?.isSuperadmin === true); }
async function requireApproved(req, res, next) {
  const profile = await profileFor(req.user.uid); req.profile = profile;
  if (isSuperadmin(req)) return next();
  const status = profile.accountStatus || profile.account_status || 'pending';
  if (status !== 'approved') return res.status(403).json({ error: 'Account approval required', code: `ACCOUNT_${String(status).toUpperCase()}`, accountStatus: status });
  next();
}
async function requireSuperadmin(req, res, next) { const profile = await profileFor(req.user.uid); if (!isSuperadmin(req)) return res.status(403).json({ error: 'Superadmin access required' }); req.profile = profile; next(); }
async function audit(req, action, targetUid, metadata = {}) { await db.collection('auditLogs').add({ action, actorUid: req.user.uid, targetUid: targetUid || null, metadata, createdAt: admin.firestore.FieldValue.serverTimestamp() }); }

// Hosting rewrites preserve the /api prefix, while direct function calls use
// /health. Keep both paths public so smoke checks never require a user token.
app.get(['/health', '/api/health'], (_req, res) => res.json({ status: 'ok', service: 'firebase-functions' }));
app.get('/api/auth/session', authenticate, async (req, res) => {
  const profile = await db.collection('users').doc(req.user.uid).get();
  const trees = await db.collection('trees').where('ownerUid', '==', req.user.uid).get();
  const families = trees.docs.map(d => ({ id: d.id, name: d.get('name') || 'My Family Tree', role: 'owner' }));
  const data = profile.exists ? profile.data() : {};
  const context = { uid: req.user.uid, email: req.user.email || null, phone_number: req.user.phone_number || null, family_name: data.familyName || data.family_name || null, account_status: data.accountStatus || data.account_status || 'pending', is_superadmin: isSuperadmin(req), families, active_family_id: families[0]?.id || null, active_family: families[0] || null };
  res.json({ authenticated: true, user: { uid: req.user.uid, email: req.user.email || null }, profile: profile.exists ? data : null, context });
});
app.get('/api/auth/me', authenticate, async (req, res) => {
  const profile = await db.collection('users').doc(req.user.uid).get();
  const trees = await db.collection('trees').where('ownerUid', '==', req.user.uid).get();
  const data = profile.exists ? profile.data() : {};
  res.json({ uid: req.user.uid, email: req.user.email || null, ...data, account_status: data.accountStatus || data.account_status || 'pending', families: trees.docs.map(d => ({ id: d.id, name: d.get('name') || 'My Family Tree', role: 'owner' })) });
});
app.post('/api/auth/profile', authenticate, async (req, res) => {
  const ref = db.collection('users').doc(req.user.uid); const existing = await ref.get();
  const familyName = String(req.body.family_name || req.body.familyName || 'My Family Tree').trim().slice(0, 160) || 'My Family Tree';
  await ref.set({ email: req.user.email || null, phoneNumber: req.user.phone_number || req.body.phone_number || null, familyName, accountStatus: existing.exists ? (existing.get('accountStatus') || 'pending') : 'pending', emailVerified: Boolean(req.user.email_verified), updatedAt: admin.firestore.FieldValue.serverTimestamp(), createdAt: existing.exists ? existing.get('createdAt') : admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  const own = await db.collection('trees').where('ownerUid', '==', req.user.uid).limit(1).get();
  if (own.empty) { const tree = db.collection('trees').doc(); await tree.set({ ownerUid: req.user.uid, name: familyName, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }); await tree.collection('members').doc(req.user.uid).set({ role: 'owner', joinedAt: admin.firestore.FieldValue.serverTimestamp() }); }
  res.status(existing.exists ? 200 : 201).json({ ok: true, accountStatus: existing.exists ? (existing.get('accountStatus') || 'pending') : 'pending' });
});

app.get('/api/superadmin/accounts', authenticate, requireSuperadmin, async (req, res) => {
  const status = String(req.query.status || 'all'); const snap = await db.collection('users').limit(200).get();
  const accounts = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(a => status === 'all' || (a.accountStatus || a.account_status || 'pending') === status).map(a => ({ id: a.id, email: a.email || null, phoneNumber: a.phoneNumber || null, familyName: a.familyName || a.family_name || null, accountStatus: a.accountStatus || a.account_status || 'pending', isSuperadmin: Boolean(a.isSuperadmin) }));
  res.json({ accounts });
});
async function changeAccountStatus(req, res, status) {
  const uid = String(req.params.userId || ''); if (!uid || uid === req.user.uid) return res.status(400).json({ error: 'Invalid target account' });
  const ref = db.collection('users').doc(uid); const snap = await ref.get(); if (!snap.exists) return res.status(404).json({ error: 'Account not found' });
  const reason = String(req.body.reason || '').slice(0, 500);
  await ref.set({ accountStatus: status, statusChangedAt: admin.firestore.FieldValue.serverTimestamp(), statusChangedBy: req.user.uid, rejectionReason: status === 'rejected' ? reason : null }, { merge: true });
  await audit(req, `account.${status}`, uid, status === 'rejected' ? { reason } : {}); res.json({ ok: true, id: uid, accountStatus: status });
}
app.patch('/api/superadmin/accounts/:userId/approve', authenticate, requireSuperadmin, (req, res) => changeAccountStatus(req, res, 'approved'));
app.patch('/api/superadmin/accounts/:userId/reject', authenticate, requireSuperadmin, (req, res) => changeAccountStatus(req, res, 'rejected'));
app.patch('/api/superadmin/accounts/:userId/suspend', authenticate, requireSuperadmin, (req, res) => changeAccountStatus(req, res, 'suspended'));
app.patch('/api/superadmin/accounts/:userId/reactivate', authenticate, requireSuperadmin, (req, res) => changeAccountStatus(req, res, 'approved'));
app.get('/api/superadmin/audit', authenticate, requireSuperadmin, async (_req, res) => { const snap = await db.collection('auditLogs').orderBy('createdAt', 'desc').limit(200).get(); res.json({ entries: snap.docs.map(d => ({ id: d.id, ...d.data() })) }); });

// Approval-screen compatibility endpoints. These intentionally remain usable
// for authenticated pending users, while family-data routes stay gated.
app.get('/api/account/access', authenticate, async (req, res) => {
  const profile = await profileFor(req.user.uid);
  const submissions = await db.collection('users').doc(req.user.uid).collection('paymentSubmissions').orderBy('createdAt', 'desc').limit(1).get();
  const latest = submissions.empty ? {} : submissions.docs[0].data();
  const accountStatus = isSuperadmin(req) ? 'approved' : (profile.accountStatus || profile.account_status || 'pending');
  res.json({ access: {
    account_status: accountStatus,
    is_superadmin: isSuperadmin(req),
    email_verified_at: req.user.email ? (req.user.email_verified ? (profile.emailVerifiedAt || true) : null) : true,
    unlock_fee_kes: Number(process.env.ACCOUNT_UNLOCK_FEE_KES || 500),
    payment_phone: process.env.MPESA_PAYMENT_PHONE || '254113245740',
    mpesa_reference: latest.mpesaReference || null,
    payer_phone: latest.payerPhone || null,
    rejection_reason: profile.rejectionReason || latest.rejectionReason || null,
    review_note: latest.reviewNote || null,
  } });
});
app.post('/api/account/payment-submissions', authenticate, async (req, res) => {
  const profile = await profileFor(req.user.uid); const status = profile.accountStatus || profile.account_status || 'pending';
  if (isSuperadmin(req) || status === 'approved') return res.status(400).json({ error: 'Account is already approved' });
  const requiresEmailVerification = Boolean(req.user.email && req.user.firebase?.sign_in_provider === 'password');
  if (requiresEmailVerification && !req.user.email_verified) return res.status(403).json({ error: 'Verify your email before submitting payment proof' });
  const reference = String(req.body.mpesa_reference || req.body.mpesaReference || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6,24}$/.test(reference)) return res.status(400).json({ error: 'Enter a valid M-Pesa transaction code' });
  const ref = db.collection('users').doc(req.user.uid).collection('paymentSubmissions').doc();
  await ref.set({ mpesaReference: reference, payerPhone: String(req.body.payer_phone || req.body.payerPhone || '').trim().slice(0, 32) || null, amountKes: Number(process.env.ACCOUNT_UNLOCK_FEE_KES || 500), createdAt: admin.firestore.FieldValue.serverTimestamp() });
  await db.collection('users').doc(req.user.uid).set({ accountStatus: 'payment_submitted', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  res.status(201).json({ ok: true, accountStatus: 'payment_submitted' });
});

function iso(value) { return value?.toDate ? value.toDate().toISOString() : value || null; }
function archiveEventShape(id, data, req) { return { id, ...data, created_at: iso(data.createdAt), updated_at: iso(data.updatedAt), can_edit: data.createdByUid === req.user.uid || ['owner', 'admin'].includes(req.role), person_name: data.personName || 'Family member' }; }
function archiveStoryShape(id, data, req) { return { id, ...data, created_at: iso(data.createdAt), updated_at: iso(data.updatedAt), author_name: data.authorName || req.user.email || 'Family member', people: data.people || [], comment_count: Number(data.commentCount || 0), can_edit: data.createdByUid === req.user.uid || ['owner', 'admin'].includes(req.role) }; }
app.use('/api/archive', authenticate, requireApproved, requireTreeOrFirst);
app.get('/api/archive/overview', async (req, res) => {
  const [events, stories] = await Promise.all([treeRef(req.treeId).collection('events').get(), treeRef(req.treeId).collection('stories').get()]);
  const years = events.docs.map(d => String(d.get('eventDate') || '').match(/\d{4}/)?.[0]).filter(Boolean);
  res.json({ stats: { events: events.size, stories: stories.size, years_spanned: years.length ? Math.max(...years.map(Number)) - Math.min(...years.map(Number)) + 1 : 0 } });
});
app.get('/api/archive/events', async (req, res) => { const snap = await treeRef(req.treeId).collection('events').orderBy('eventDate').get(); let events = snap.docs.map(d => archiveEventShape(d.id, d.data(), req)); if (req.query.person_id) events = events.filter(e => String(e.person_id || e.personId) === String(req.query.person_id)); if (req.query.type) events = events.filter(e => e.event_type === req.query.type); if (req.query.q) events = events.filter(e => JSON.stringify(e).toLowerCase().includes(String(req.query.q).toLowerCase())); res.json({ events }); });
app.post('/api/archive/events', async (req, res) => { if (!canWrite(req.role)) return res.sendStatus(403); const ref = treeRef(req.treeId).collection('events').doc(); const data = { personId: String(req.body.person_id || ''), event_type: String(req.body.event_type || 'other'), event_date: req.body.event_date || null, end_date: req.body.end_date || null, title: String(req.body.title || '').slice(0, 180), place: req.body.place || null, description: req.body.description || null, source_title: req.body.source_title || null, source_url: req.body.source_url || null, visibility: req.body.visibility || 'family', createdByUid: req.user.uid, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }; await ref.set(data); res.status(201).json(archiveEventShape(ref.id, data, req)); });
app.put('/api/archive/events/:id', async (req, res) => { if (!canWrite(req.role)) return res.sendStatus(403); const ref = treeRef(req.treeId).collection('events').doc(req.params.id); if (!(await ref.get()).exists) return res.sendStatus(404); await ref.set({ ...req.body, personId: String(req.body.person_id || req.body.personId || ''), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }); res.json({ id: req.params.id, ...req.body }); });
app.delete('/api/archive/events/:id', async (req, res) => { if (!canWrite(req.role)) return res.sendStatus(403); await treeRef(req.treeId).collection('events').doc(req.params.id).delete(); res.sendStatus(204); });
app.get('/api/archive/stories', async (req, res) => { const snap = await treeRef(req.treeId).collection('stories').orderBy('createdAt', 'desc').get(); let stories = snap.docs.map(d => archiveStoryShape(d.id, d.data(), req)); if (req.query.person_id) stories = stories.filter(s => (s.people || []).some(p => String(p.id) === String(req.query.person_id))); if (req.query.q) stories = stories.filter(s => JSON.stringify(s).toLowerCase().includes(String(req.query.q).toLowerCase())); res.json({ stories }); });
app.post('/api/archive/stories', async (req, res) => { if (!canWrite(req.role)) return res.sendStatus(403); const ref = treeRef(req.treeId).collection('stories').doc(); const data = { title: String(req.body.title || '').slice(0, 220), body: String(req.body.body || '').slice(0, 20000), story_date: req.body.story_date || null, place: req.body.place || null, visibility: req.body.visibility || 'family', people: [], commentCount: 0, createdByUid: req.user.uid, authorName: req.user.email || 'Family member', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }; await ref.set(data); res.status(201).json({ story: archiveStoryShape(ref.id, data, req) }); });
app.put('/api/archive/stories/:id', async (req, res) => { if (!canWrite(req.role)) return res.sendStatus(403); const ref = treeRef(req.treeId).collection('stories').doc(req.params.id); if (!(await ref.get()).exists) return res.sendStatus(404); await ref.set({ title: req.body.title, body: req.body.body, story_date: req.body.story_date || null, place: req.body.place || null, visibility: req.body.visibility || 'family', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }); res.json({ id: req.params.id, ...req.body }); });
app.delete('/api/archive/stories/:id', async (req, res) => { if (!canWrite(req.role)) return res.sendStatus(403); await treeRef(req.treeId).collection('stories').doc(req.params.id).delete(); res.sendStatus(204); });
app.get('/api/archive/stories/:id', async (req, res) => { const snap = await treeRef(req.treeId).collection('stories').doc(req.params.id).get(); if (!snap.exists) return res.sendStatus(404); const comments = await snap.ref.collection('comments').orderBy('createdAt').get(); res.json({ story: archiveStoryShape(snap.id, snap.data(), req), comments: comments.docs.map(d => ({ id: d.id, ...d.data(), created_at: iso(d.get('createdAt')), author_name: d.get('authorName') || 'Family member', can_delete: d.get('createdByUid') === req.user.uid })) }); });
app.post('/api/archive/stories/:id/comments', async (req, res) => { const story = treeRef(req.treeId).collection('stories').doc(req.params.id); if (!(await story.get()).exists) return res.sendStatus(404); const ref = story.collection('comments').doc(); await ref.set({ body: String(req.body.body || '').slice(0, 2000), authorName: req.user.email || 'Family member', createdByUid: req.user.uid, createdAt: admin.firestore.FieldValue.serverTimestamp() }); res.status(201).json({ id: ref.id }); });
app.delete('/api/archive/comments/:id', async (req, res) => { const stories = await treeRef(req.treeId).collection('stories').get(); for (const story of stories.docs) { const ref = story.ref.collection('comments').doc(req.params.id); const snap = await ref.get(); if (snap.exists && (snap.get('createdByUid') === req.user.uid || ['owner', 'admin'].includes(req.role))) { await ref.delete(); return res.sendStatus(204); } } res.sendStatus(404); });

// All family data routes require an approved account (superadmins bypass).
app.use(['/api/trees', '/api/tree', '/api/persons', '/api/relationships'], authenticate, requireApproved);
app.get('/api/trees', authenticate, requireApproved, async (req, res) => {
  const owned = await db.collection('trees').where('ownerUid', '==', req.user.uid).get();
  const member = await db.collectionGroup('members').where(admin.firestore.FieldPath.documentId(), '==', req.user.uid).get().catch(() => ({ docs: [] }));
  const out = new Map(owned.docs.map(d => ({ id: d.id, ...d.data() })).map(x => [x.id, x]));
  for (const m of member.docs) { const parent = m.ref.parent.parent; if (parent) { const t = await parent.get(); if (t.exists) out.set(t.id, { id: t.id, ...t.data() }); } }
  res.json([...out.values()]);
});
app.post('/api/trees', authenticate, requireApproved, async (req, res) => {
  const name = String(req.body.name || req.body.family_name || 'My Family Tree').trim().slice(0, 160);
  const ref = db.collection('trees').doc();
  await ref.set({ ownerUid: req.user.uid, name, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  await ref.collection('members').doc(req.user.uid).set({ role: 'owner', joinedAt: admin.firestore.FieldValue.serverTimestamp() });
  res.status(201).json({ id: ref.id, ownerUid: req.user.uid, name });
});
async function requireTreeOrFirst(req, res, next) {
  if (req.params.treeId || req.query.treeId || req.body.treeId || req.get('x-tree-id')) return requireTree(req, res, next);
  const own = await db.collection('trees').where('ownerUid', '==', req.user.uid).limit(1).get();
  if (!own.empty) { req.treeId = own.docs[0].id; req.role = 'owner'; return next(); }
  return res.status(404).json({ error: 'No family tree exists' });
}
app.get('/api/tree', authenticate, requireTreeOrFirst, async (req, res) => {
  const [tree, persons, relationships] = await Promise.all([
    treeRef(req.treeId).get(), treeRef(req.treeId).collection('persons').get(), treeRef(req.treeId).collection('relationships').get()
  ]);
  if (!tree.exists) return res.status(404).json({ error: 'Tree not found' });
  res.json({ tree: { id: tree.id, ...tree.data() }, persons: persons.docs.map(d => ({ id: d.id, ...d.data() })), relationships: relationships.docs.map(d => ({ id: d.id, ...d.data() })) });
});
app.put('/api/tree', authenticate, requireTreeOrFirst, async (req, res) => { if (!['owner', 'admin'].includes(req.role)) return res.sendStatus(403); const name = String(req.body.name || req.body.family_name || '').trim().slice(0, 160); if (!name) return res.status(400).json({ error: 'Tree name is required' }); await treeRef(req.treeId).set({ name, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }); res.json({ id: req.treeId, name }); });
app.get('/api/persons', authenticate, requireTreeOrFirst, async (req, res) => { const s = await treeRef(req.treeId).collection('persons').get(); res.json(s.docs.map(d => ({ id: d.id, ...d.data() }))); });
app.post('/api/persons', authenticate, requireTreeOrFirst, async (req, res) => { if (!canWrite(req.role)) return res.sendStatus(403); const ref = treeRef(req.treeId).collection('persons').doc(); const data = { ...req.body, firstName: req.body.firstName ?? req.body.first_name ?? null, lastName: req.body.lastName ?? req.body.last_name ?? null, photoPath: req.body.photoPath ?? req.body.photo_path ?? null, createdByUid: req.user.uid, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }; await ref.set(data); res.status(201).json({ id: ref.id, ...data }); });
app.put('/api/persons/:id', authenticate, requireTree, async (req, res) => { if (!canWrite(req.role)) return res.sendStatus(403); const ref = treeRef(req.treeId).collection('persons').doc(req.params.id); if (!(await ref.get()).exists) return res.sendStatus(404); await ref.set({ ...req.body, firstName: req.body.firstName ?? req.body.first_name, lastName: req.body.lastName ?? req.body.last_name, photoPath: req.body.photoPath ?? req.body.photo_path, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }); res.json({ id: req.params.id, ...req.body }); });
app.delete('/api/persons/:id', authenticate, requireTree, async (req, res) => { if (!canWrite(req.role)) return res.sendStatus(403); const personRef = treeRef(req.treeId).collection('persons').doc(req.params.id); const person = await personRef.get(); if (!person.exists) return res.sendStatus(404); const batch = db.batch(); batch.set(treeRef(req.treeId).collection('recycleBin').doc(req.params.id), { ...person.data(), deletedAt: admin.firestore.FieldValue.serverTimestamp(), expiresAt: new Date(Date.now() + 30 * 86400000), deletionReason: String(req.body?.reason || 'Deleted by family member').slice(0, 300) }); batch.delete(personRef); const rs = await treeRef(req.treeId).collection('relationships').where('person1Id', '==', req.params.id).get(); const rs2 = await treeRef(req.treeId).collection('relationships').where('person2Id', '==', req.params.id).get(); [...rs.docs, ...rs2.docs].forEach(d => batch.delete(d.ref)); await batch.commit(); res.sendStatus(204); });
app.get('/api/relationships', authenticate, requireTreeOrFirst, async (req, res) => { const s = await treeRef(req.treeId).collection('relationships').get(); res.json(s.docs.map(d => ({ id: d.id, ...d.data() }))); });
app.post('/api/relationships', authenticate, requireTreeOrFirst, async (req, res) => { if (!canWrite(req.role)) return res.sendStatus(403); const person1Id = req.body.person1Id ?? req.body.person1_id; const person2Id = req.body.person2Id ?? req.body.person2_id; const type = req.body.type; if (!person1Id || !person2Id || person1Id === person2Id || !['parent','child','spouse','sibling','related','grandparent','grandchild','relative'].includes(type)) return res.status(400).json({ error: 'Invalid relationship' }); const refs = [treeRef(req.treeId).collection('persons').doc(String(person1Id)), treeRef(req.treeId).collection('persons').doc(String(person2Id))]; const snaps = await Promise.all(refs.map(r => r.get())); if (snaps.some(s => !s.exists)) return res.status(400).json({ error: 'Both people must exist in this tree' }); const ref = treeRef(req.treeId).collection('relationships').doc(); const data = { ...req.body, person1Id: String(person1Id), person2Id: String(person2Id), type, createdByUid: req.user.uid, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }; await ref.set(data); res.status(201).json({ id: ref.id, ...data }); });
app.delete('/api/relationships/:id', authenticate, requireTree, async (req, res) => { if (!canWrite(req.role)) return res.sendStatus(403); await treeRef(req.treeId).collection('relationships').doc(req.params.id).delete(); res.sendStatus(204); });

// Firebase-native feature APIs. These replace the former PostgreSQL feature
// modules while preserving the response contracts used by the shipped UI.
function featureRouter(prefix, collectionName) {
  const router = express.Router();
  const responseKey = collectionName === 'memories' ? 'items' : collectionName;
  router.use(authenticate, requireApproved, requireTreeOrFirst);
  router.get('/', async (req, res) => {
    const snap = await treeRef(req.treeId).collection(collectionName).orderBy('createdAt', 'desc').limit(500).get().catch(async () => treeRef(req.treeId).collection(collectionName).limit(500).get());
    res.json({ [responseKey]: snap.docs.map(d => ({ id: d.id, ...d.data(), created_at: iso(d.get('createdAt')), updated_at: iso(d.get('updatedAt')), people: d.get('people') || [] })) });
  });
  router.post('/', async (req, res) => {
    if (!canWrite(req.role)) return res.sendStatus(403);
    const ref = treeRef(req.treeId).collection(collectionName).doc();
    const data = { ...req.body, createdByUid: req.user.uid, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    await ref.set(data); const out = { id: ref.id, ...data }; res.status(201).json(responseKey === 'items' ? { item: out } : out);
  });
  router.patch('/:id', async (req, res) => {
    if (!canWrite(req.role)) return res.sendStatus(403);
    const ref = treeRef(req.treeId).collection(collectionName).doc(req.params.id); if (!(await ref.get()).exists) return res.sendStatus(404);
    await ref.set({ ...req.body, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }); res.json({ id: req.params.id, ...req.body });
  });
  router.delete('/:id', async (req, res) => {
    if (!canWrite(req.role)) return res.sendStatus(403);
    await treeRef(req.treeId).collection(collectionName).doc(req.params.id).delete(); res.sendStatus(204);
  });
  app.use(prefix, router);
}

// Evidence/source library.
app.get('/api/evidence/sources', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => {
  const snap = await treeRef(req.treeId).collection('evidenceSources').orderBy('createdAt', 'desc').get().catch(async () => treeRef(req.treeId).collection('evidenceSources').get());
  let sources = await Promise.all(snap.docs.map(async d => { const citations = await d.ref.collection('citations').get(); return { id: d.id, ...d.data(), citation_count: citations.size, created_at: iso(d.get('createdAt')) }; }));
  if (req.query.q) { const q = String(req.query.q).toLowerCase(); sources = sources.filter(s => JSON.stringify(s).toLowerCase().includes(q)); }
  res.json({ sources });
});
app.post('/api/evidence/sources', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => {
  if (!canWrite(req.role)) return res.sendStatus(403); const ref = treeRef(req.treeId).collection('evidenceSources').doc();
  const data = { title: String(req.body.title || '').trim().slice(0, 240), source_type: String(req.body.source_type || 'other'), repository: req.body.repository || null, archive_location: req.body.archive_location || null, call_number: req.body.call_number || null, publication_info: req.body.publication_info || null, source_date: req.body.source_date || null, description: req.body.description || null, createdByUid: req.user.uid, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (!data.title) return res.status(400).json({ error: 'Source title is required' }); await ref.set(data); res.status(201).json({ id: ref.id, ...data, citation_count: 0 });
});
app.get('/api/evidence/citations', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => {
  const sources = await treeRef(req.treeId).collection('evidenceSources').get(); const rows = [];
  for (const source of sources.docs) { const s = await source.ref.collection('citations').get(); s.docs.forEach(d => { const x = d.data(); if ((!req.query.subject_type || x.subject_type === req.query.subject_type) && (!req.query.subject_id || String(x.subject_id) === String(req.query.subject_id))) rows.push({ id: d.id, ...x, source_title: source.get('title') }); }); }
  res.json({ citations: rows });
});
app.post('/api/evidence/citations', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => {
  if (!canWrite(req.role)) return res.sendStatus(403); const source = treeRef(req.treeId).collection('evidenceSources').doc(String(req.body.source_id)); if (!(await source.get()).exists) return res.status(404).json({ error: 'Source not found' }); const ref = source.collection('citations').doc();
  const data = { subject_type: String(req.body.subject_type || 'person'), subject_id: String(req.body.subject_id || ''), fact_key: String(req.body.fact_key || 'custom'), claim_value: String(req.body.claim_value || '').slice(0, 10000), confidence: String(req.body.confidence || 'probable'), research_note: req.body.research_note || null, createdByUid: req.user.uid, createdAt: admin.firestore.FieldValue.serverTimestamp() }; await ref.set(data); res.status(201).json({ id: ref.id, ...data, source_title: (await source.get()).get('title') });
});

// Memories, albums, recipes and memorials. Media upload remains on the
// existing Firebase Storage client; this API stores the metadata safely.
for (const [path, collection] of [['/api/memories/items', 'memories'], ['/api/memories/albums', 'albums'], ['/api/memories/recipes', 'recipes'], ['/api/memories/memorials', 'memorials']]) featureRouter(path, collection);
app.get('/api/memories/overview', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { const counts = {}; for (const c of ['memories', 'albums', 'recipes', 'memorials']) counts[c] = (await treeRef(req.treeId).collection(c).get()).size; res.json({ stats: counts }); });
app.get('/api/memories/calendar', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { const people = await treeRef(req.treeId).collection('persons').get(); const calendar = []; people.docs.forEach(d => { const p = d.data(); for (const [field, label] of [['birthDate', 'birthday'], ['deathDate', 'memorial']]) if (p[field] || p[field.replace(/[A-Z]/g, x => `_${x.toLowerCase()}`)]) calendar.push({ id: d.id, first_name: p.firstName || p.first_name || '', last_name: p.lastName || p.last_name || '', event_date: p[field] || p[field.replace(/[A-Z]/g, x => `_${x.toLowerCase()}`)], reminder_type: label }); }); res.json({ calendar }); });

// Quality and collaboration workroom.
app.get('/api/quality/findings', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { const s = await treeRef(req.treeId).collection('qualityFindings').get(); const status = String(req.query.status || 'open'); res.json({ findings: s.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => status === 'all' || (x.status || 'open') === status) }); });
app.post('/api/quality/scan', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { if (!canWrite(req.role)) return res.sendStatus(403); const people = await treeRef(req.treeId).collection('persons').get(); const findings = []; people.docs.forEach(d => { const p = d.data(); if (!(p.firstName || p.first_name)) findings.push({ rule_code: 'missing-first-name', severity: 'warning', title: 'Person is missing a first name', details: 'Add a first name to improve search and tree readability.', subject_type: 'person', subject_id: d.id, status: 'open' }); }); const col = treeRef(req.treeId).collection('qualityFindings'); for (const f of findings) await col.add({ ...f, createdAt: admin.firestore.FieldValue.serverTimestamp(), createdByUid: req.user.uid }); res.json({ findings: findings.length }); });
app.patch('/api/quality/findings/:id', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { if (!canWrite(req.role)) return res.sendStatus(403); await treeRef(req.treeId).collection('qualityFindings').doc(req.params.id).set({ status: String(req.body.status || 'reviewed'), reviewedByUid: req.user.uid, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }); res.json({ ok: true }); });
app.get('/api/collaboration/overview', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { const t = treeRef(req.treeId); const read = async c => (await t.collection(c).get()).docs.map(d => ({ id: d.id, ...d.data(), created_at: iso(d.get('createdAt')) })); res.json({ proposals: await read('collabProposals'), comments: await read('collabComments'), tasks: await read('collabTasks'), notifications: (await read('collabNotifications')).filter(n => n.uid === req.user.uid || !n.uid), activity: await read('activity'), findings: await read('qualityFindings'), announcements: await read('collabAnnouncements') }); });
featureRouter('/api/collaboration/tasks', 'collabTasks'); featureRouter('/api/collaboration/comments', 'collabComments'); featureRouter('/api/collaboration/announcements', 'collabAnnouncements');
app.get('/api/collaboration/announcements', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { const s = await treeRef(req.treeId).collection('collabAnnouncements').orderBy('createdAt', 'desc').get().catch(async () => treeRef(req.treeId).collection('collabAnnouncements').get()); res.json({ announcements: s.docs.map(d => ({ id: d.id, ...d.data() })) }); });
app.patch('/api/collaboration/notifications/:id/read', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { await treeRef(req.treeId).collection('collabNotifications').doc(req.params.id).set({ read_at: new Date().toISOString(), readByUid: req.user.uid }, { merge: true }); res.json({ ok: true }); });
app.patch('/api/collaboration/proposals/:id/review', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { if (!['owner', 'admin'].includes(req.role)) return res.sendStatus(403); const ref = treeRef(req.treeId).collection('collabProposals').doc(req.params.id); if (!(await ref.get()).exists) return res.sendStatus(404); await ref.set({ status: String(req.body.status || 'rejected'), reviewedByUid: req.user.uid, reviewedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }); res.json({ ok: true }); });

// Discovery and safe soft-delete/duplicate management.
app.get('/api/discovery/search', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { const q = String(req.query.q || '').trim().toLowerCase(); const s = await treeRef(req.treeId).collection('persons').get(); const people = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => !q || JSON.stringify(p).toLowerCase().includes(q)).slice(0, 100); res.json({ people }); });
app.get('/api/recycle-bin/persons', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { const s = await treeRef(req.treeId).collection('recycleBin').get(); res.json({ persons: s.docs.map(d => ({ id: d.id, ...d.data(), deleted_at: iso(d.get('deletedAt')), expires_at: iso(d.get('expiresAt')) })) }); });
app.post('/api/recycle-bin/persons/:id/restore', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { if (!canWrite(req.role)) return res.sendStatus(403); const ref = treeRef(req.treeId).collection('recycleBin').doc(req.params.id), snap = await ref.get(); if (!snap.exists) return res.sendStatus(404); const { deletedAt, expiresAt, ...person } = snap.data(); await treeRef(req.treeId).collection('persons').doc(req.params.id).set({ ...person, restoredAt: admin.firestore.FieldValue.serverTimestamp() }); await ref.delete(); res.json({ ok: true }); });
app.delete('/api/recycle-bin/persons/:id', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { if (req.role !== 'owner') return res.sendStatus(403); await treeRef(req.treeId).collection('recycleBin').doc(req.params.id).delete(); res.sendStatus(204); });
app.get('/api/duplicates', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { const s = await treeRef(req.treeId).collection('persons').get(); const groups = new Map(); s.docs.forEach(d => { const p = d.data(); const key = `${String(p.firstName || p.first_name || '').trim().toLowerCase()}|${String(p.lastName || p.last_name || '').trim().toLowerCase()}`; if (key !== '|') (groups.get(key) || groups.set(key, []).get(key)).push({ id: d.id, ...p }); }); res.json([...groups.entries()].filter(([, people]) => people.length > 1).map(([group, persons]) => ({ group: group.replace('|', ' '), persons }))); });
app.post('/api/merge', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { if (!['owner', 'admin'].includes(req.role)) return res.sendStatus(403); const keepId = String(req.body.keepId || ''), mergeIds = (req.body.mergeIds || []).map(String).filter(x => x !== keepId); const persons = treeRef(req.treeId).collection('persons'), relationships = treeRef(req.treeId).collection('relationships'); const keep = await persons.doc(keepId).get(); if (!keep.exists || !mergeIds.length) return res.status(400).json({ error: 'A valid keep record and merge records are required' }); const batch = db.batch(); for (const id of mergeIds) { const old = await persons.doc(id).get(); if (!old.exists) continue; const [a, b] = await Promise.all([relationships.where('person1Id', '==', id).get(), relationships.where('person2Id', '==', id).get()]); [...a.docs, ...b.docs].forEach(d => batch.set(d.ref, { ...(d.data().person1Id === id ? { person1Id: keepId } : {}), ...(d.data().person2Id === id ? { person2Id: keepId } : {}), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })); batch.set(treeRef(req.treeId).collection('recycleBin').doc(id), { ...old.data(), deletedAt: admin.firestore.FieldValue.serverTimestamp(), deletionReason: `Merged into ${keepId}`, expiresAt: new Date(Date.now() + 30 * 86400000) }); batch.delete(old.ref); } await batch.commit(); res.json({ ok: true, kept: keepId, merged: mergeIds }); });

// Family membership and invitation compatibility for the existing workspace.
app.post('/api/families', authenticate, requireApproved, async (req, res) => { const name = String(req.body.name || 'My Family Tree').trim().slice(0, 160); const ref = db.collection('trees').doc(); await ref.set({ ownerUid: req.user.uid, name, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }); await ref.collection('members').doc(req.user.uid).set({ role: 'owner', joinedAt: admin.firestore.FieldValue.serverTimestamp() }); res.status(201).json({ id: ref.id, name }); });
app.post('/api/families/:id/select', authenticate, requireApproved, async (req, res) => { const role = await memberRole(req.params.id, req.user.uid); if (!role) return res.sendStatus(403); res.json({ ok: true, active_family_id: String(req.params.id), role }); });
app.get('/api/family/members', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { const s = await treeRef(req.treeId).collection('members').get(); const members = await Promise.all(s.docs.map(async d => { const p = await profileFor(d.id); return { id: d.id, user_id: d.id, email: p.email || null, family_name: p.familyName || null, role: d.get('role') || 'viewer' }; })); res.json({ members }); });
app.patch('/api/family/members/:userId', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { if (!['owner', 'admin'].includes(req.role)) return res.sendStatus(403); const role = String(req.body.role || 'viewer'); if (!['viewer', 'contributor', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' }); await treeRef(req.treeId).collection('members').doc(req.params.userId).set({ role, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }); res.json({ ok: true }); });
app.delete('/api/family/members/:userId', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { if (!['owner', 'admin'].includes(req.role)) return res.sendStatus(403); await treeRef(req.treeId).collection('members').doc(req.params.userId).delete(); res.sendStatus(204); });
app.put('/api/family/owner', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { if (req.role !== 'owner') return res.sendStatus(403); const uid = String(req.body.user_id || req.body.userId || ''); if (!uid) return res.status(400).json({ error: 'User is required' }); await treeRef(req.treeId).set({ ownerUid: uid }, { merge: true }); await treeRef(req.treeId).collection('members').doc(uid).set({ role: 'owner' }, { merge: true }); res.json({ ok: true }); });
app.get('/api/family/invitations', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { const s = await treeRef(req.treeId).collection('invitations').get(); res.json({ invitations: s.docs.map(d => ({ id: d.id, ...d.data() })) }); });
app.post('/api/family/invitations', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { if (!['owner', 'admin'].includes(req.role)) return res.sendStatus(403); const token = crypto.randomUUID(); const ref = treeRef(req.treeId).collection('invitations').doc(token); await ref.set({ token, email: String(req.body.email || '').trim().toLowerCase() || null, role: String(req.body.role || 'viewer'), createdByUid: req.user.uid, createdAt: admin.firestore.FieldValue.serverTimestamp(), expiresAt: new Date(Date.now() + 7 * 86400000) }); res.status(201).json({ id: token, token }); });
app.delete('/api/family/invitations/:id', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { if (!['owner', 'admin'].includes(req.role)) return res.sendStatus(403); await treeRef(req.treeId).collection('invitations').doc(req.params.id).delete(); res.sendStatus(204); });
app.get('/api/invitations/:token', authenticate, async (req, res) => { const trees = await db.collection('trees').get(); for (const t of trees.docs) { const s = await t.ref.collection('invitations').doc(req.params.token).get(); if (s.exists) return res.json({ invitation: { id: s.id, ...s.data() }, family: { id: t.id, name: t.get('name') } }); } res.sendStatus(404); });
app.post('/api/invitations/:token/accept', authenticate, async (req, res) => { const trees = await db.collection('trees').get(); for (const t of trees.docs) { const ref = t.ref.collection('invitations').doc(req.params.token), s = await ref.get(); if (s.exists) { await t.ref.collection('members').doc(req.user.uid).set({ role: s.get('role') || 'viewer', joinedAt: admin.firestore.FieldValue.serverTimestamp() }); await ref.delete(); return res.json({ ok: true, family_id: t.id }); } } res.sendStatus(404); });
app.get('/api/account/data-export', authenticate, async (req, res) => { const trees = await db.collection('trees').where('ownerUid', '==', req.user.uid).get(); const out = []; for (const t of trees.docs) { const [p, r] = await Promise.all([t.ref.collection('persons').get(), t.ref.collection('relationships').get()]); out.push({ tree: { id: t.id, ...t.data() }, persons: p.docs.map(d => ({ id: d.id, ...d.data() })), relationships: r.docs.map(d => ({ id: d.id, ...d.data() })) }); } res.type('application/json').set('Content-Disposition', 'attachment; filename="lineage-export.json"').send(JSON.stringify({ exportedAt: new Date().toISOString(), uid: req.user.uid, trees: out })); });

// Share links are opaque, revocable documents; shared reads remain scoped to
// the link's tree and never expose member/admin collections.
app.get('/api/exploration/share-links', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { const s = await treeRef(req.treeId).collection('shareLinks').get(); res.json({ links: s.docs.map(d => ({ id: d.id, ...d.data() })) }); });
app.post('/api/exploration/share-links', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { if (!['owner', 'admin'].includes(req.role)) return res.sendStatus(403); const token = crypto.randomUUID(); await treeRef(req.treeId).collection('shareLinks').doc(token).set({ token, label: String(req.body.label || 'Family tree').slice(0, 120), createdByUid: req.user.uid, createdAt: admin.firestore.FieldValue.serverTimestamp() }); res.status(201).json({ token, url: `${process.env.PUBLIC_APP_URL || ''}/?share=${token}` }); });
app.delete('/api/exploration/share-links/:id', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { if (!['owner', 'admin'].includes(req.role)) return res.sendStatus(403); await treeRef(req.treeId).collection('shareLinks').doc(req.params.id).delete(); res.sendStatus(204); });
app.post('/api/memories/items/:id/qr', authenticate, requireApproved, requireTreeOrFirst, async (_req, res) => res.status(501).json({ error: 'QR generation is not enabled in this deployment' }));
app.get('/api/gedcom/export', authenticate, requireApproved, requireTreeOrFirst, async (req, res) => { const people = await treeRef(req.treeId).collection('persons').get(); const rels = await treeRef(req.treeId).collection('relationships').get(); const lines = ['0 HEAD', '1 SOUR LINEAGE', '1 CHAR UTF-8']; people.docs.forEach(d => { const p = d.data(); lines.push(`0 @I${d.id}@ INDI`, `1 NAME ${p.firstName || p.first_name || ''} /${p.lastName || p.last_name || ''}/`); if (p.gender) lines.push(`1 SEX ${String(p.gender).charAt(0).toUpperCase()}`); if (p.birthDate || p.birth_date) lines.push('1 BIRT', `2 DATE ${p.birthDate || p.birth_date}`); }); rels.docs.forEach(d => { const r = d.data(); if (r.type === 'parent') lines.push(`0 @F${d.id}@ FAM`, `1 CHIL @I${r.person2Id || r.person2_id}@`, `1 NOTE Parent @I${r.person1Id || r.person1_id}@`); }); lines.push('0 TRLR'); res.type('text/plain').set('Content-Disposition', 'attachment; filename="lineage-family.ged"').send(lines.join('\r\n') + '\r\n'); });
app.post('/api/gedcom/preview', authenticate, requireApproved, requireTreeOrFirst, async (_req, res) => res.status(501).json({ error: 'GEDCOM import preview is not enabled in this deployment; export remains available.' }));
app.post('/api/gedcom/import/:id', authenticate, requireApproved, requireTreeOrFirst, async (_req, res) => res.status(501).json({ error: 'GEDCOM import is not enabled in this deployment.' }));
app.delete('/api/account', authenticate, async (_req, res) => res.status(501).json({ error: 'Account deletion requires a verified destructive-operation workflow.' }));

app.use((req, res) => res.status(404).json({ error: 'Route not found', path: req.path }));
app.use((err, req, res, _next) => { console.error('firebase_api_error', { path: req.path, method: req.method, code: err.code, message: err.message }); res.status(500).json({ error: 'Server error' }); });

exports.api = onRequest({ region: 'us-central1', cors: false }, app);
