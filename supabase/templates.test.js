'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, 'templates');
const templates = {
  'confirmation.html': ['{{ .ConfirmationURL }}', 'تأكيد البريد الإلكتروني'],
  'recovery.html': ['{{ .ConfirmationURL }}', 'إعادة تعيين كلمة المرور'],
  'invite.html': ['{{ .ConfirmationURL }}', 'قبول الدعوة'],
  'magic_link.html': ['{{ .ConfirmationURL }}', 'تسجيل الدخول'],
  'email_change.html': ['{{ .ConfirmationURL }}', 'تأكيد البريد الجديد'],
  'reauthentication.html': ['{{ .Token }}', 'رمز التحقق']
};

test('Supabase Auth email templates use the approved V2 palette and expected secure variables', () => {
  for (const [file, [variable, label]] of Object.entries(templates)) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(html.includes(variable), file + ' must contain the expected Supabase variable');
    assert.ok(html.includes(label), file + ' must contain its Arabic action label');
    assert.ok(html.includes('src="https://hares.aboserag925.workers.dev/icon.svg"') && html.includes('alt="حرس الحدود"'), file + ' must use the approved shield asset');
    assert.ok(html.includes('#176b49') && html.includes('#c5a04a') && html.includes('#f5f9f5'),
      file + ' must use the approved V2 palette');
    assert.ok(html.includes('dir="rtl"'), file + ' must support RTL');
    assert.doesNotMatch(html, /Aref Ruqaa|Reem Kufi|Cairo|Amiri|IBM Plex|#0b0e0d/);
  }
});

test('Supabase template rollout is documented as a manual hosted-dashboard action', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /Authentication → Email Templates/);
  assert.match(readme, /لم يتم تعديل إعدادات Auth/);
  assert.match(readme, /لا تغيّر إعدادات SMTP/);
});
