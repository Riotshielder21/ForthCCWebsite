import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    browserName: 'chromium',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4175 --strictPort --mode test',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    env: {
      VITE_API_BASE_URL: '',
      VITE_FIREBASE_API_KEY: 'browser-tests',
      VITE_FIREBASE_PROJECT_ID: 'demo-fcc-browser',
      VITE_FIREBASE_AUTH_DOMAIN: 'demo-fcc-browser.firebaseapp.com',
      VITE_FIREBASE_APP_ID: '1:123:web:browser-tests',
      VITE_USE_FIREBASE_EMULATORS: 'false'
    }
  }
});
