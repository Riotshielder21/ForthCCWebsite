import { onIdTokenChanged, signOut } from 'firebase/auth';
import { auth, initializeAuth, signInWithWorkspace as signIn } from './firebase.js';

export const subscribeAdminSession = (listener) => {
  let active = true;
  let unsubscribe = () => {};
  initializeAuth().then(() => {
    if (!active) return;
    if (!auth) {
      listener(null);
      return;
    }
    unsubscribe = onIdTokenChanged(auth, listener);
  }).catch(() => { if (active) listener(null); });
  return () => { active = false; unsubscribe(); };
};

export const currentAdminUser = () => auth?.currentUser || null;
export const signInWithWorkspace = () => signIn();
export const signOutAdmin = () => auth ? signOut(auth) : Promise.resolve();
