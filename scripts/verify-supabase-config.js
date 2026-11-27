'use strict';

const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const APPROVED_URL = 'https://uzepglfimareggswjzlf.supabase.co';
const CONFIG_PATH = process.argv[2] || path.resolve(__dirname, '..', 'app', 'supabase-config.js');

function verify(source) {
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { timeout: 1000 });
  const config = sandbox.window.AHL_SUPABASE_CONFIG;
  if (!config || typeof config.url !== 'string' || typeof config.anonKey !== 'string') return { ok: false, reason: 'missing config shape' };
  if (!config.url.trim() || !config.anonKey.trim()) return { ok: false, reason: 'empty' };
  if (config.url !== APPROVED_URL) return { ok: false, reason: 'url mismatch' };
  return { ok: true };
}

if (require.main === module) {
  try {
    const source = fs.readFileSync(CONFIG_PATH, 'utf8');
    const result = verify(source);
    if (!result.ok) {
      console.error('Supabase config verification failed: ' + result.reason);
      process.exit(1);
    }
    console.log('Supabase config present and matches approved project; values withheld.');
  } catch (error) {
    console.error('Supabase config verification failed: ' + error.message);
    process.exit(1);
  }
}

module.exports = { APPROVED_URL, verify };
