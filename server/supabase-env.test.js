'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSupabaseEnv } = require('./supabase-env');

test('strips a leading Unicode BOM and surrounding whitespace from Supabase settings', function () {
  const bom = String.fromCharCode(0xFEFF);
  const original = {
    SUPABASE_URL: bom + 'https://project.example.supabase.co ',
    SUPABASE_ANON_KEY: bom + 'anon-test-key ',
    SUPABASE_SERVICE_ROLE_KEY: bom + 'service-test-key '
  };
  const normalized = normalizeSupabaseEnv(original);
  assert.equal(normalized.SUPABASE_URL, 'https://project.example.supabase.co');
  assert.equal(normalized.SUPABASE_ANON_KEY, 'anon-test-key');
  assert.equal(normalized.SUPABASE_SERVICE_ROLE_KEY, 'service-test-key');
  assert.equal(original.SUPABASE_ANON_KEY.charCodeAt(0), 0xFEFF);
});

test('preserves absent optional Supabase settings', function () {
  assert.deepEqual(normalizeSupabaseEnv({ PORT: '8080' }), { PORT: '8080' });
});
