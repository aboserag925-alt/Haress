import fs from 'node:fs';
import vm from 'node:vm';

const email = process.env.SUPABASE_E2E_NON_ADMIN_EMAIL;
const password = process.env.SUPABASE_E2E_NON_ADMIN_PASSWORD;
if (!email || !password) {
  console.error('BLOCKED: dedicated non-admin test credentials are not configured. Set SUPABASE_E2E_NON_ADMIN_EMAIL and SUPABASE_E2E_NON_ADMIN_PASSWORD in the Preview-Build-CI environment; no account was created.');
  process.exit(1);
}

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync('app/supabase-config.js', 'utf8'), sandbox, { timeout: 1000 });
const config = sandbox.window.AHL_SUPABASE_CONFIG;
if (!config?.url || !config?.anonKey || config.url !== 'https://bevyztwoijjzfngutnys.supabase.co') {
  throw new Error('Refusing authenticated authorization smoke test: Supabase Preview configuration mismatch.');
}

const login = await fetch(config.url + '/auth/v1/token?grant_type=password', {
  method: 'POST',
  headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});
if (!login.ok) {
  console.error('FAIL: dedicated non-admin test account could not authenticate (HTTP ' + login.status + ').');
  process.exit(1);
}
const session = await login.json();
if (!session.access_token) {
  console.error('FAIL: Supabase did not return an access token for the dedicated test account.');
  process.exit(1);
}

const headers = { apikey: config.anonKey, Authorization: 'Bearer ' + session.access_token };
const checks = [
  ['lectures-admin', config.url + '/functions/v1/lectures-admin/admin/session'],
  ['admin-operations', config.url + '/functions/v1/admin-operations/admin/suggestions']
];
let failed = false;
for (const [name, url] of checks) {
  const response = await fetch(url, { headers });
  if (response.status !== 403) {
    console.error('FAIL: authenticated non-admin request to ' + name + ' returned HTTP ' + response.status + '; expected 403.');
    failed = true;
  } else {
    console.log('PASS: authenticated non-admin request to ' + name + ' returned HTTP 403.');
  }
}
if (failed) process.exit(1);
console.log('PASS: both admin Edge Functions deny the dedicated authenticated non-admin test account.');
