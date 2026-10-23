import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithCustomToken, onAuthStateChanged, signInWithPopup, setPersistence, browserLocalPersistence, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { apiUrl } from './api.js';
import { ADMIN_DOMAIN, isClubEmail } from './adminAccess.js';

const runtimeEnv = typeof import.meta.env !== 'undefined' ? import.meta.env : process.env;
const localEmulators = runtimeEnv.DEV === true && runtimeEnv.VITE_USE_FIREBASE_EMULATORS === 'true';

// Firebase Configuration
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: runtimeEnv.VITE_FIREBASE_API_KEY,
  authDomain: runtimeEnv.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: runtimeEnv.VITE_FIREBASE_PROJECT_ID,
  storageBucket: runtimeEnv.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: runtimeEnv.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: runtimeEnv.VITE_FIREBASE_APP_ID,
  measurementId: runtimeEnv.VITE_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase lazily and safely so config/auth issues do not blank the whole app.
let app = null;
let auth = null;
let db = null;
let storage = null;
let analytics = null;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
  if (localEmulators) {
    if (!firebaseConfig.projectId?.startsWith('demo-')) throw new Error('Use a demo- project for local Firebase.');
    const host = runtimeEnv.VITE_FIREBASE_EMULATOR_HOST || '127.0.0.1';
    if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('Firebase emulators must use a loopback host.');
    if (!auth.emulatorConfig) {
      connectAuthEmulator(auth, `http://${host}:${Number(runtimeEnv.VITE_FIREBASE_AUTH_EMULATOR_PORT) || 9099}`, { disableWarnings: true });
      connectFirestoreEmulator(db, host, Number(runtimeEnv.VITE_FIREBASE_FIRESTORE_EMULATOR_PORT) || 8080);
      connectStorageEmulator(storage, host, Number(runtimeEnv.VITE_FIREBASE_STORAGE_EMULATOR_PORT) || 9199);
    }
  }
  if (!localEmulators && typeof window !== 'undefined') {
    isSupported().then((supported) => {
      if (supported) analytics = getAnalytics(app);
    }).catch(() => {});
  }
} catch (error) {
  auth = null;
  db = null;
  storage = null;
  console.error('Firebase initialization failed:', error);
}

const appId = typeof __app_id !== 'undefined' ? __app_id : 'forth-canoe-default';

// Auth Functions
const performAuthInitialization = async () => {
  if (!auth) return;
  await auth.authStateReady();
  if (auth.currentUser) return;

  if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
    try {
      await signInWithCustomToken(auth, __initial_auth_token);
    } catch (error) {
      console.error('Custom token auth failed:', error);
    }
  }
};

let authInitialization = null;
export const initializeAuth = () => {
  if (!authInitialization) authInitialization = performAuthInitialization();
  return authInitialization;
};

export const setupAuthListener = (callback) => {
  if (!auth) {
    callback(null);
    return () => {};
  }

  return onAuthStateChanged(auth, callback);
};

export const signInWithWorkspace = async () => {
  if (!auth) throw new Error('Firebase authentication is unavailable.');
  await initializeAuth();
  await setPersistence(auth, browserLocalPersistence);
  if (localEmulators) {
    const result = await signInWithEmailAndPassword(auth, 'admin@forthcanoeclub.co.uk', 'local-test-password');
    return result.user;
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: ADMIN_DOMAIN });
  const result = await signInWithPopup(auth, provider);
  if (!isClubEmail(result.user.email)) {
    await auth.signOut();
    throw new Error('Use a Forth Canoe Club Google Workspace account.');
  }

  return result.user;
};

export const validateDiscountCode = async (code) => {
  const response = await fetch(apiUrl('/api/discount-codes/validate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not validate discount code.');
  return result;
};

// Export Firebase instances
export { auth, db, storage, analytics, app, appId };
