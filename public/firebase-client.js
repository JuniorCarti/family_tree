/* Modular Firebase Web SDK bridge. A deployment supplies the public config
   through window.LINEAGE_FIREBASE_CONFIG before this file is loaded. Admin
   credentials must never be placed here. */
(function bootstrapFirebaseBridge(global) {
  const config = global.LINEAGE_FIREBASE_CONFIG;
  global.LineageFirebaseAuth = null;
  global.LineageFirebaseReady = (async () => {
    if (!config?.apiKey || !config?.appId || !config?.projectId) return null;
    const [{ initializeApp }, authModule, storageModule] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js'),
    ]);
    const app = initializeApp(config);
    const auth = authModule.getAuth(app);
    const local = ['localhost', '127.0.0.1'].includes(global.location.hostname);
    if (local && global.location.port !== '5000') authModule.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    await authModule.setPersistence(auth, authModule.browserLocalPersistence);
    global.LineageFirebaseAuth = auth;
    global.LineageFirebaseAuthApi = {
      signIn: (email, password) => authModule.signInWithEmailAndPassword(auth, email, password),
      signUp: (email, password) => authModule.createUserWithEmailAndPassword(auth, email, password),
      signInGoogle: () => authModule.signInWithPopup(auth, new authModule.GoogleAuthProvider()),
      signInPhone: (phone, verifier) => authModule.signInWithPhoneNumber(auth, phone, verifier),
      createRecaptcha: container => new authModule.RecaptchaVerifier(auth, container, { size: 'invisible' }),
      signOut: () => authModule.signOut(auth),
      resetPassword: email => authModule.sendPasswordResetEmail(auth, email),
      verifyEmail: () => auth.currentUser ? authModule.sendEmailVerification(auth.currentUser, { url: 'https://family-tree-a4c4f.web.app/', handleCodeInApp: false }) : Promise.reject(new Error('Authentication required')),
      refresh: async () => { if (!auth.currentUser) return null; await auth.currentUser.reload(); await auth.currentUser.getIdToken(true); return auth.currentUser; },
    };
    const storage = storageModule.getStorage(app);
    if (local && global.location.port !== '5000') storageModule.connectStorageEmulator(storage, '127.0.0.1', 9199);
    global.LineageFirebaseStorage = {
      async upload(file, treeId, personId) {
        if (!auth.currentUser) throw new Error('Authentication required');
        if (!file || !file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.');
        const safeName = String(file.name || 'photo').replace(/[^a-z0-9._-]/gi, '_');
        const path = `users/${auth.currentUser.uid}/trees/${treeId}/persons/${personId || `draft-${crypto.randomUUID()}`}/${safeName}`;
        const object = storageModule.ref(storage, path);
        await storageModule.uploadBytes(object, file, { contentType: file.type });
        return { path, url: await storageModule.getDownloadURL(object) };
      },
      async remove(path) { if (path) await storageModule.deleteObject(storageModule.ref(storage, path)); },
    };
    await new Promise(resolve => authModule.onAuthStateChanged(auth, resolve));
    return auth;
  })().catch(error => {
    console.error('Firebase initialization failed', { code: error?.code || 'unknown' });
    throw error;
  });
})(window);
