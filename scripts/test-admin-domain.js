import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, terminate } from 'firebase/firestore';
import { getStorage, connectStorageEmulator, ref, uploadBytes } from 'firebase/storage';
import { assertLocalFirebase } from '../src/utils/localFirebase.js';

const projectId = assertLocalFirebase(process.env);
const adminApp = initializeAdminApp({ projectId });
const adminAuth = getAdminAuth(adminApp);
const adminDb = getAdminFirestore(adminApp);
const browserApp = initializeApp({ apiKey: 'demo-api-key', projectId, storageBucket: `${projectId}.appspot.com` });
const auth = getAuth(browserApp);
connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
const db = getFirestore(browserApp);
const [firestoreHost, firestorePort] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
connectFirestoreEmulator(db, firestoreHost, Number(firestorePort));
const storage = getStorage(browserApp);
const [storageHost, storagePort] = process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':');
connectStorageEmulator(storage, storageHost, Number(storagePort));
const fixture = `admin-domain-${Date.now()}`;
const images = [`pages/home/${fixture}/logo.png`, `products/${fixture}/logo.png`];
const port = 13003;
const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
server.stdout.on('data', (chunk) => { output += chunk; });
server.stderr.on('data', (chunk) => { output += chunk; });
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`API startup failed: ${output}`)), 15000);
    server.stdout.on('data', () => {
      if (output.includes(`running at http://127.0.0.1:${port}`)) { clearTimeout(timer); resolve(); }
    });
    server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`API exited ${code}: ${output}`)); });
  });
  for (const [domain, admin, allowed] of [
    ['forthcanoeclub.co.uk', true, true],
    ['forthcanoeclub.co.uk', false, false],
    ['example.com', true, false],
    ['forthcanoeclub.co.uk.evil.com', true, false],
    ['sub.forthcanoeclub.co.uk', true, false]
  ]) {
    const candidate = await adminAuth.createUser({ email: `${fixture}@${domain}`, emailVerified: true });
    try {
      const token = await adminAuth.createCustomToken(candidate.uid, { admin });
      const signedIn = await signInWithCustomToken(auth, token);
      const headers = { Authorization: `Bearer ${await signedIn.user.getIdToken()}`, 'Content-Type': 'application/json' };
      const response = await fetch(`http://127.0.0.1:${port}/api/admin/admins`, { headers });
      assert.equal(response.status, allowed ? 200 : 403, domain);
      if (allowed) {
        for (const email of [`${fixture}@example.com`, `${fixture}@forthcanoeclub.co.uk.evil.com`]) {
          const grant = await fetch(`http://127.0.0.1:${port}/api/admin/admins`, {
            method: 'POST', headers, body: JSON.stringify({ action: 'grant', email })
          });
          assert.equal(grant.status, 400, email);
          assert.match((await grant.json()).error, /Only @forthcanoeclub\.co\.uk accounts can be admins/);
        }
      }
      const write = () => setDoc(doc(db, 'products', fixture), { name: 'Domain test' });
      if (allowed) await write();
      else await assert.rejects(write(), { code: 'permission-denied' }, domain);
      for (const path of images) {
        const upload = () => uploadBytes(ref(storage, path), Buffer.from('test'), { contentType: 'image/png' });
        if (allowed) {
          await upload();
        } else {
          await assert.rejects(upload(), { code: 'storage/unauthorized' }, domain);
        }
      }
    } finally {
      await adminAuth.deleteUser(candidate.uid);
    }
  }
  console.log('Admin domain checks passed: approval, API, Firestore and both Storage upload paths.');
} finally {
  if (server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
  }
  await adminDb.collection('products').doc(fixture).delete();
  for (const path of images) {
    // The emulator's owner token bypasses client rules, which intentionally disallow image deletion.
    const response = await fetch(`http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${projectId}.appspot.com/o/${encodeURIComponent(path)}`, {
      method: 'DELETE', headers: { Authorization: 'Bearer owner' }
    });
    assert.ok(response.ok || response.status === 404, `Could not clean up ${path}: ${response.status}`);
  }
  await terminate(db);
  await deleteApp(browserApp);
  await adminDb.terminate();
  await deleteAdminApp(adminApp);
}
