'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createMediaLibrary } = require('../media-library');

test('bot router runs inside the media library loop and unhandled updates fall through', async function () {
  const storageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahl-bot-int-'));
  const seen = [];
  const calls = [];
  const library = createMediaLibrary({
    env: { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_MEDIA_GROUP_ID: '-1', TELEGRAM_MEDIA_ENABLED: 'false' },
    fetch: async function (url) { calls.push(url); throw new Error('no network expected'); },
    storageDirectory: storageDirectory,
    updateHandler: async function (update) { seen.push(update.update_id); return update.update_id === 1; }
  });
  try {
    await library.processUpdate({ update_id: 1, message: { chat: { id: -1 }, text: '/help' } });
    await library.processUpdate({ update_id: 2, message: { chat: { id: -1 }, text: 'hello' } });
    assert.deepEqual(seen, [1, 2]);
    assert.equal(calls.length, 0);
  } finally {
    await fs.rm(storageDirectory, { recursive: true, force: true });
  }
});
