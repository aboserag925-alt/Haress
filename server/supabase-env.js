'use strict';

const SUPABASE_ENV_KEYS = Object.freeze([
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY'
]);

function normalizeSupabaseEnv(env) {
  const normalized = { ...(env || {}) };
  for (const key of SUPABASE_ENV_KEYS) {
    if (typeof normalized[key] === 'string') {
      normalized[key] = normalized[key].replace(/^\\uFEFF+/u, '').trim();
    }
  }
  return normalized;
}

module.exports = { normalizeSupabaseEnv, SUPABASE_ENV_KEYS };
