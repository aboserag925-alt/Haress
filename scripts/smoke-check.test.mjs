import assert from 'node:assert/strict';
import test from 'node:test';
import { validateHtmlRtl } from './smoke-check.mjs';

test('validateHtmlRtl accepts root <html lang="ar" dir="rtl">', () => {
  const ok = validateHtmlRtl('<!doctype html><html lang="ar" dir="rtl"><body>ok</body></html>');
  assert.equal(ok.ok, true);
});

test('validateHtmlRtl fails when dir="rtl" is removed from <html> even if present elsewhere', () => {
  const html = '<!doctype html><html lang="ar"><body><div dir="rtl">ok</div></body></html>';
  const result = validateHtmlRtl(html);
  assert.equal(result.ok, false);
  assert.match(result.reason, /root <html>/);
});

test('validateHtmlRtl fails when <html> is missing RTL markers', () => {
  assert.equal(validateHtmlRtl('<html lang="en" dir="ltr"></html>').ok, false);
});
