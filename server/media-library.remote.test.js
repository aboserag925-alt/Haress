'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createMediaLibrary } = require('./media-library');
const { MemoryStore } = require('./media-storage');

const MANIFEST_KEY = 'library/media-index.json';

function telegramResponse(payload) {
  return {
    ok: true,
    arrayBuffer: async function () {
      return Buffer.from(JSON.stringify({ ok: true, result: payload }), 'utf8');
    }
  };
}

function createFetch() {
  return async function (url) {
    if (url.includes('/getFile')) return telegramResponse({ file_path: 'documents/lesson.mp3' });
    if (url.includes('/getChatMember')) return telegramResponse({ status: 'administrator' });
    if (url.includes('/sendMessage')) return telegramResponse({ message_id: 101 });
    if (url.includes('/answerCallbackQuery')) return telegramResponse(true);
    if (url.includes('/editMessageText')) return telegramResponse({ message_id: 101 });
    if (url.includes('/file/bot')) {
      return { ok: true, arrayBuffer: async function () { return Buffer.from('audio bytes'); } };
    }
    throw new Error('Unexpected mocked Telegram request: ' + url);
  };
}

function createLibrary(storage) {
  return createMediaLibrary({
    env: {
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_MEDIA_ENABLED: 'false',
      TELEGRAM_MEDIA_GROUP_ID: '-100123'
    },
    fetch: createFetch(),
    storage: storage
  });
}

test('remote media manifest survives process restart and retains approved file metadata', async function () {
  const storage = new MemoryStore();
  const first = createLibrary(storage);

  await first.processUpdate({
    update_id: 1,
    message: {
      chat: { id: -100123 },
      date: 1793500000,
      caption: 'درس الخميس #كتب',
      document: {
        file_id: 'telegram-file-id',
        file_unique_id: 'telegram-unique-id',
        file_name: 'lesson.mp3',
        mime_type: 'audio/mpeg',
        file_size: 11
      }
    }
  });

  const manifestObject = await storage.get(MANIFEST_KEY);
  assert.ok(manifestObject, 'remote manifest should be written');
  const manifest = JSON.parse(manifestObject.body.toString('utf8'));
  assert.equal(manifest.items.length, 1);
  assert.equal(manifest.items[0].status, 'pending');
  const id = manifest.items[0].id;

  const restartedBeforeReview = createLibrary(storage);
  assert.deepEqual(await restartedBeforeReview.listApproved(), []);

  await restartedBeforeReview.processUpdate({
    update_id: 2,
    callback_query: {
      id: 'callback-id',
      data: 'media:approve:' + id,
      from: { id: 7 },
      message: { message_id: 101, chat: { id: -100123 } }
    }
  });

  const restartedAfterReview = createLibrary(storage);
  const approved = await restartedAfterReview.listApproved();
  assert.equal(approved.length, 1);
  assert.equal(approved[0].id, id);
  assert.equal(approved[0].title, 'درس الخميس');

  const file = await restartedAfterReview.getApprovedFile(id);
  assert.equal(file.data.toString('utf8'), 'audio bytes');
  const saved = JSON.parse((await storage.get(MANIFEST_KEY)).body.toString('utf8'));
  assert.equal(saved.items[0].status, 'approved');
});

test('remote rejection status survives restart and rejected file is not public', async function () {
  const storage = new MemoryStore();
  const library = createLibrary(storage);

  await library.processUpdate({
    update_id: 1,
    message: {
      chat: { id: -100123 },
      caption: 'درس مرفوض',
      document: {
        file_id: 'telegram-file-id',
        file_unique_id: 'telegram-unique-id',
        file_name: 'lesson.mp3',
        mime_type: 'audio/mpeg',
        file_size: 11
      }
    }
  });
  const manifest = JSON.parse((await storage.get(MANIFEST_KEY)).body.toString('utf8'));
  const id = manifest.items[0].id;

  await library.processUpdate({
    update_id: 2,
    callback_query: {
      id: 'callback-id',
      data: 'media:reject:' + id,
      from: { id: 7 },
      message: { message_id: 101, chat: { id: -100123 } }
    }
  });

  const restarted = createLibrary(storage);
  assert.deepEqual(await restarted.listApproved(), []);
  const saved = JSON.parse((await storage.get(MANIFEST_KEY)).body.toString('utf8'));
  assert.equal(saved.items[0].status, 'rejected');
  assert.equal(await storage.get(saved.items[0].objectKey), null);
});

test('remote media library fails closed when its manifest is corrupt', async function () {
  const storage = new MemoryStore();
  await storage.put(MANIFEST_KEY, Buffer.from('{invalid json'), 'application/json');
  const library = createLibrary(storage);
  await assert.rejects(library.listApproved(), /Invalid remote media library index/);
});

test('remote media library rejects structurally invalid manifests instead of loading unsafe metadata', async function () {
  const invalidManifests = [
    { offset: -1, items: [] },
    { offset: null, items: [{ id: 'not-a-uuid', status: 'approved' }] },
    { offset: null, items: [{ id: 'a8e0c2d1-91b4-4f37-8b11-3c9e4b9e9a11', status: 'unknown' }] }
  ];
  for (const manifest of invalidManifests) {
    const storage = new MemoryStore();
    await storage.put(MANIFEST_KEY, Buffer.from(JSON.stringify(manifest)), 'application/json');
    const library = createLibrary(storage);
    await assert.rejects(library.listApproved(), /Invalid remote media library index/);
  }
});
