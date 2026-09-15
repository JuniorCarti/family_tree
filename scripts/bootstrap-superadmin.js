#!/usr/bin/env node
/* Safe, explicit bootstrap. It never authorizes by email and refuses to guess a UID. */
const admin = require('../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp();
const uid = process.env.SUPERADMIN_UID;
if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
  console.error('SUPERADMIN_UID is required; sign in with the intended provider first and pass its Firebase Auth UID.');
  process.exit(2);
}
(async () => {
  const user = await admin.auth().getUser(uid);
  const claims = { ...(user.customClaims || {}), superadmin: true };
  await admin.auth().setCustomUserClaims(uid, claims);
  await admin.firestore().collection('users').doc(uid).set({ email: user.email || null, phoneNumber: user.phoneNumber || null, isSuperadmin: true, accountStatus: 'approved', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  console.log(JSON.stringify({ ok: true, uid, providerCount: user.providerData.length, claims: ['superadmin'], accountStatus: 'approved' }));
})().catch(error => { console.error(`Superadmin bootstrap failed: ${error.code || error.message}`); process.exit(1); });
