'use strict';
const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync(new URL('./assistant-widget.js', 'file://' + __filename), 'utf8');
const html = fs.readFileSync(new URL('./index.html', 'file://' + __filename), 'utf8');

test('assistant widget is loaded by the Arabic RTL app', () => {
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /assistant-widget\.css/);
  assert.match(html, /assistant-widget\.js/);
});

test('assistant is a local navigation guide and does not send chat content to a provider', () => {
  assert.match(source, /لا تُرسل رسائلك إلى خدمة ذكاء اصطناعي/);
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|WebSocket/);
  assert.match(source, /لا أقدّم فتاوى/);
});

test('assistant destinations match existing app sections', () => {
  for (const id of ['sched','prayers','qibla','adhkar','media','q','about','account']) {
    assert.match(source, new RegExp(id));
  }
});
