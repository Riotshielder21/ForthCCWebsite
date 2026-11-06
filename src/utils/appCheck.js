import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } from 'firebase/app-check';

const env = import.meta.env || {};
let appCheck = null;

export const initializeBrowserAppCheck = (app) => {
  if (typeof window === 'undefined' || env.VITE_USE_FIREBASE_EMULATORS === 'true'
    || ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) return;
  // A missing key must not disable Auth, Firestore and Storage for the whole site.
  if (!env.VITE_APPCHECK_SITE_KEY) {
    console.error('App Check is not configured for this website; requests will be unverified.');
    return;
  }
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(env.VITE_APPCHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true
  });
};

export const browserAppCheckToken = async () => {
  if (!appCheck) return null;
  try {
    return (await getToken(appCheck)).token;
  } catch (error) {
    if (env.VITE_APP_CHECK_MODE === 'enforce') {
      throw new Error('Website verification failed. Check your connection and reload before trying again.', { cause: error });
    }
    console.warn('App Check verification failed in monitor mode:', error.code || error.message);
    return null;
  }
};
