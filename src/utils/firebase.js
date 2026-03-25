import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, setDoc, addDoc, serverTimestamp } from 'firebase/firestore';

// Firebase Configuration
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: "",
  authDomain: "forth-canoe-club.firebaseapp.com",
  projectId: "forth-canoe-club",
  storageBucket: "forth-canoe-club.appspot.com",
  appId: "forth-canoe-club-id"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'forth-canoe-default';

// Auth Functions
export const initializeAuth = async () => {
  if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
    await signInWithCustomToken(auth, __initial_auth_token);
  } else {
    await signInAnonymously(auth);
  }
};

export const setupAuthListener = (callback) => {
  return onAuthStateChanged(auth, callback);
};

// Export Firebase instances
export { auth, db, app, appId };

// Firestore exports
export { collection, onSnapshot, doc, setDoc, addDoc, serverTimestamp };
