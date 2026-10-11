import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalFirebase } from './localFirebase.js';

test('emulator tools reject real projects or non-local services', () => {
  const env = { LOCAL_FIREBASE_EMULATORS: 'true', GCLOUD_PROJECT: 'demo-fcc', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199' };
  assert.equal(assertLocalFirebase(env), 'demo-fcc');
  assert.throws(() => assertLocalFirebase({ ...env, GCLOUD_PROJECT: 'production-fcc' }));
  assert.throws(() => assertLocalFirebase({ ...env, FIRESTORE_EMULATOR_HOST: 'remote.example.com:8080' }));
  assert.throws(() => assertLocalFirebase({ ...env, FIREBASE_AUTH_EMULATOR_HOST: undefined }));
});