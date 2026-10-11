export const assertLocalFirebase = (env) => {
  if (env.LOCAL_FIREBASE_EMULATORS !== 'true' || !/^demo-[a-z0-9-]+$/.test(env.GCLOUD_PROJECT || '')) {
    throw new Error('Local Firebase requires LOCAL_FIREBASE_EMULATORS=true and a demo- GCLOUD_PROJECT.');
  }
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(env[key] || '')) throw new Error(`${key} must point to a local emulator.`);
  }
  return env.GCLOUD_PROJECT;
};