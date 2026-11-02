import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { assertLocalFirebase } from '../src/utils/localFirebase.js';

assertLocalFirebase(process.env);
const env = { ...process.env };
for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'GITHUB_CONTENT_TOKEN', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'STRIPE_REPORT_SECRET_KEY', 'STRIPE_SUBSCRIPTION_ADMIN_KEY', 'NODE_ENV']) delete env[key];
Object.assign(env, {
  RENEWAL_JOB_TOKEN: 'local-renewal-job-token-0123456789abcdef',
  PUBLIC_SITE_URL: 'https://fccwebsite-23cfc.web.app',
  PUBLIC_SITE_URLS: 'https://staging.example.test',
  WEBSITE_ISLIVE: 'true',
  STRIPE_SUBSCRIPTION_ADMIN_KEY: 'sk_test_local_admin',
  STRIPE_SECRET_KEY: 'sk_test_local_fixture',
  STRIPE_WEBHOOK_SECRET: 'whsec_local_only',
  METADATA_SERVER_DETECTION: 'none',
  PORT: '3010', HOST: '127.0.0.1', TEST_API_PORT: '3010'
});

const run = async (command, args) => {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const child = spawn(command, args, { env, stdio: 'inherit' });
  const [code, signal] = await once(child, 'exit');
  if (code !== 0) throw new Error(`${command} ${args.join(' ')} failed (${signal || code}).`);
};

const failures = [];
const check = async (command, args) => {
  try { await run(command, args); }
  catch (error) { console.error(error.message); failures.push(error); }
};
await run(process.execPath, ['scripts/seed-emulators.js']);
for (const script of ['test-admin-domain.js', 'test-emulators.js', 'test-club-night.js', 'test-volunteering.js',
  'test-item-actions.js', 'test-gdpr.js']) await check(process.execPath, [`scripts/${script}`]);
for (const script of ['test-justgo-api.py', 'test-justgo-sync.py', 'test-justgo-upload.py']) await check(process.env.PYTHON || 'python3', [`scripts/${script}`]);
await run(process.execPath, ['scripts/seed-emulators.js']);

const api = spawn(process.execPath, ['--import', './scripts/mock-stripe.mjs', 'server.js'], { env, stdio: 'inherit' });
const exited = once(api, 'exit');
try {
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline && api.exitCode === null) {
    try { ready = (await fetch('http://127.0.0.1:3010/health', { signal: AbortSignal.timeout(1000) })).ok; }
    catch (error) {
      if (!['ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'].includes(error.cause?.code) && error.name !== 'TimeoutError') throw error;
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Mock API did not become healthy within 30 seconds.');
  await check(process.execPath, ['scripts/test-checkout-flow.js']);
} finally {
  if (api.exitCode === null) api.kill('SIGTERM');
  await exited;
}
if (failures.length) throw new AggregateError(failures, `${failures.length} integration suites failed.`);
