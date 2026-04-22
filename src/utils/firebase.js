import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, setDoc, addDoc, serverTimestamp, query, where, getDocs } from 'firebase/firestore';

// Firebase Configuration
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: "",
  authDomain: "forth-canoe-club.firebaseapp.com",
  projectId: "forth-canoe-club",
  storageBucket: "forth-canoe-club.appspot.com",
  appId: "forth-canoe-club-id"
};

// Initialize Firebase lazily and safely so config/auth issues do not blank the whole app.
let app = null;
let auth = null;
let db = null;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (error) {
  console.error('Firebase initialization failed:', error);
}

const appId = typeof __app_id !== 'undefined' ? __app_id : 'forth-canoe-default';

// Auth Functions
export const initializeAuth = async () => {
  if (!auth) return;

  if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
    try {
      await signInWithCustomToken(auth, __initial_auth_token);
    } catch (error) {
      console.error('Custom token auth failed:', error);
      await signInAnonymously(auth);
    }
  } else {
    try {
      await signInAnonymously(auth);
    } catch (error) {
      console.error('Anonymous auth failed:', error);
    }
  }
};

export const setupAuthListener = (callback) => {
  if (!auth) {
    callback(null);
    return () => {};
  }

  return onAuthStateChanged(auth, callback);
};

// Member Verification Functions
export const verifyMember = async (name) => {
  try {
    if (!db) {
      return { verified: false, error: 'database_unavailable' };
    }

    const membersRef = collection(db, 'artifacts', appId, 'public', 'data', 'members');
    const q = query(membersRef, where('name', '>=', name), where('name', '<=', name + '\uf8ff'));
    const querySnapshot = await getDocs(q);

    // Look for exact name match (case-insensitive)
    const member = querySnapshot.docs.find(doc => {
      const memberName = doc.data().name?.toLowerCase().trim();
      const searchName = name.toLowerCase().trim();
      return memberName === searchName;
    });

    return member ? { verified: true, memberData: member.data() } : { verified: false };
  } catch (error) {
    console.error('Error verifying member:', error);
    return { verified: false, error: error.message };
  }
};

export const generateDiscountCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'VOL';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

export const saveDiscountCode = async (name, email, discountCode) => {
  try {
    if (!db) {
      return { success: false, error: 'database_unavailable' };
    }

    await addDoc(collection(db, 'discountCodes'), {
      name,
      email,
      code: discountCode,
      used: false,
      createdAt: serverTimestamp(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year expiry
    });
    return { success: true };
  } catch (error) {
    console.error('Error saving discount code:', error);
    return { success: false, error: error.message };
  }
};

export const validateDiscountCode = async (code) => {
  try {
    if (!db) {
      return { valid: false, reason: 'unavailable' };
    }

    const codesRef = collection(db, 'discountCodes');
    const q = query(codesRef, where('code', '==', code), where('used', '==', false));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      const codeDoc = querySnapshot.docs[0];
      const codeData = codeDoc.data();

      // Check if expired
      if (codeData.expiresAt && codeData.expiresAt.toDate() < new Date()) {
        return { valid: false, reason: 'expired' };
      }

      // Support both flat (£ amount off monthly) and multiplier (percentage off)
      // discountType: 'flat' | 'multiplier'
      // discountValue: flat = £ amount off monthly, multiplier = decimal (e.g. 0.25 = 25% off)
      return {
        valid: true,
        discountType: codeData.discountType || 'multiplier',
        discountValue: codeData.discountValue ?? 0.25,
        label: codeData.label || 'Discount',
        codeData
      };
    }

    return { valid: false, reason: 'not_found' };
  } catch (error) {
    console.error('Error validating discount code:', error);
    return { valid: false, reason: 'error', error: error.message };
  }
};

// Export Firebase instances
export { auth, db, app, appId };
