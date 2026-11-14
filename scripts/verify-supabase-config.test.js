'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { verify } = require('./verify-supabase-config');

test('verify rejects empty placeholder config', function () {
  const source = 'window.AHL_SUPABASE_CONFIG = { url: \'\', anonKey: \'\' };';
  assert.equal(verify(source).ok, false);
});

test('verify accepts approved non-empty config', function () {
  const source = 'window.AHL_SUPABASE_CONFIG = { url: \'https://uzepglfimareggswjzlf.supabase.co\', anonKey: \'sb_publishable_PLACEHOLDER\' };';
  assert.equal(verify(source).ok, true);
});

test('verify rejects mismatched project URL', function () {
  const source = 'window.AHL_SUPABASE_CONFIG = { url: \'https://other.supabase.co\', anonKey: \'sb_publishable_PLACEHOLDER\' };';
  assert.equal(verify(source).ok, false);
});
