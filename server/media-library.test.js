'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createMediaLibrary } = require('./media-library');
const { MemoryStore } = require('./media-storage');

function telegramResponse(payload) {
  return {
    ok: true,
    arrayBuffer: async function () {
      return Buffer.from(JSON.stringify({ ok: true, result: payload }), 'utf8');
    }
  };
}

async function withLibrary(run, customFetch) {
  const storageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahl-media-test-'));
  const calls = [];
  const responder = customFetch || async function (url) {
    if (url.includes('/getFile')) return telegramResponse({ file_path: 'documents/lesson.mp3' });
    if (url.includes('/getChatMember')) return telegramResponse({ status: 'administrator' });
    if (url.includes('/sendMessage')) return telegramResponse({ message_id: 101 });
    if (url.includes('/answerCallbackQuery')) return telegramResponse(true);
    if (url.includes('/editMessageText')) return telegramResponse({ message_id: 101 });
    if (url.includes('/file/bot')) {
      return { ok: true, arrayBuffer: async function () { return Buffer.from('audio bytes'); } };
    }
    throw new Error('Unexpected mocked Telegram request');
  };
  const fetch = async function (url, options) {
    calls.push({ url: url, options: options });
    return responder(url, options);
  };
  const env = {
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_MEDIA_ENABLED: 'false',
    TELEGRAM_MEDIA_GROUP_ID: '-100123'
  };
  try {
    await run({
      calls: calls,
      env: env,
      fetch: fetch,
      storageDirectory: storageDirectory,
      library: createMediaLibrary({
        env: env,
        fetch: fetch,
        storageDirectory: storageDirectory
      })
    });
  } finally {
    await fs.rm(storageDirectory, { recursive: true, force: true });
  }
}

test('stores group uploads privately until an administrator approves them', async function () {
  await withLibrary(async function (context) {
    await context.library.processUpdate({
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
    assert.deepEqual(await context.library.listApproved(), []);
    assert.deepEqual(await context.library.listApproved(), []);

    const storedIndex = JSON.parse(await fs.readFile(
      path.join(context.storageDirectory, 'media-index.json'),
      'utf8'
    ));
    const pending = storedIndex.items[0];
    assert.equal(pending.status, 'pending');
    assert.equal(pending.title, 'درس الخميس');
    assert.equal(pending.category, 'books');

    const approvalRequest = context.calls.find(function (call) {
      return call.url.includes('/sendMessage');
    });
    const approvalPayload = JSON.parse(approvalRequest.options.body);
    const approvalData = approvalPayload.reply_markup.inline_keyboard[0][0].callback_data;
    await context.library.processUpdate({
      update_id: 2,
      callback_query: {
        id: 'callback-id',
        data: approvalData,
        from: { id: 7 },
        message: { message_id: 101, chat: { id: -100123 } }
      }
    });

    const published = await context.library.listApproved();
    assert.equal(published.length, 1);
    assert.equal(published[0].title, 'درس الخميس');
    assert.equal(published[0].category, 'books');
    const file = await context.library.getApprovedFile(published[0].id);
    assert.equal(file.item.mimeType, 'audio/mpeg');
    assert.equal(file.data.toString('utf8'), 'audio bytes');

    const restarted = createMediaLibrary({
      env: context.env,
      fetch: context.fetch,
      storageDirectory: context.storageDirectory
    });
    assert.equal((await restarted.listApproved()).length, 1);
  });
});

test('rejects approval actions from non-administrators', async function () {
  await withLibrary(async function (context) {
    await context.library.processUpdate({
      update_id: 1,
      message: {
        chat: { id: -100123 },
        caption: 'درس جديد',
        document: {
          file_id: 'telegram-file-id',
          file_unique_id: 'telegram-unique-id',
          file_name: 'lesson.mp3',
          file_size: 11
        }
      }
    });
    const index = JSON.parse(await fs.readFile(
      path.join(context.storageDirectory, 'media-index.json'),
      'utf8'
    ));
    const message = context.calls.find(function (call) {
      return call.url.includes('/sendMessage');
    });
    const payload = JSON.parse(message.options.body);
    const callbackData = payload.reply_markup.inline_keyboard[0][0].callback_data;
    context.fetch = async function (url) {
      context.calls.push({ url: url });
      if (url.includes('/getChatMember')) return telegramResponse({ status: 'member' });
      if (url.includes('/answerCallbackQuery')) return telegramResponse(true);
      throw new Error('Unexpected mocked Telegram request');
    };
    const library = createMediaLibrary({
      env: context.env,
      fetch: context.fetch,
      storageDirectory: context.storageDirectory
    });
    await library.processUpdate({
      update_id: 2,
      callback_query: {
        id: 'callback-id',
        data: callbackData,
        from: { id: 8 },
        message: { message_id: 101, chat: { id: -100123 } }
      }
    });
    assert.equal(index.items[0].status, 'pending');
    assert.deepEqual(await library.listApproved(), []);
  });
});

test('allows an administrator to remove an approved file from the public library', async function () {
  await withLibrary(async function (context) {
    await context.library.processUpdate({
      update_id: 1,
      message: {
        chat: { id: -100123 },
        from: { id: 7 },
        caption: 'درس جديد',
        document: {
          file_id: 'telegram-file-id',
          file_unique_id: 'telegram-unique-id',
          file_name: 'lesson.mp3',
          file_size: 11
        }
      }
    });
    const approvalMessage = context.calls.find(function (call) {
      return call.url.includes('/sendMessage');
    });
    const approvalPayload = JSON.parse(approvalMessage.options.body);
    await context.library.processUpdate({
      update_id: 2,
      callback_query: {
        id: 'callback-id',
        data: approvalPayload.reply_markup.inline_keyboard[0][0].callback_data,
        from: { id: 7 },
        message: { message_id: 101, chat: { id: -100123 } }
      }
    });
    const item = (await context.library.listApproved())[0];

    await context.library.processUpdate({
      update_id: 3,
      message: {
        chat: { id: -100123 },
        from: { id: 7 },
        text: '/media-remove ' + item.id
      }
    });

    assert.deepEqual(await context.library.listApproved(), []);
    await assert.rejects(fs.access(path.join(context.storageDirectory, 'media', item.id + '.mp3')));
  });
});

test('does not contact Telegram when media intake is disabled', async function () {
  await withLibrary(async function (context) {
    await context.library.start();
    assert.equal(context.calls.length, 0);
  });
});

test('STORAGE_DIRECTORY: explicit options.storageDirectory takes highest precedence', async function () {
  const explicitDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahl-storage-explicit-'));
  const envDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahl-storage-env-'));
  try {
    const library = createMediaLibrary({
      env: { STORAGE_DIRECTORY: envDir, TELEGRAM_MEDIA_ENABLED: 'false' },
      fetch: async function () { throw new Error('Unexpected Telegram request'); },
      storageDirectory: explicitDir
    });
    assert.deepEqual(await library.listApproved(), []); // initialize + save creates index
    await fs.access(path.join(explicitDir, 'media-index.json'));
    await assert.rejects(fs.access(path.join(envDir, 'media-index.json')), { code: 'ENOENT' });
  } finally {
    await fs.rm(explicitDir, { recursive: true, force: true });
    await fs.rm(envDir, { recursive: true, force: true });
  }
});

test('STORAGE_DIRECTORY: options.env.STORAGE_DIRECTORY is used when option omitted', async function () {
  const storageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahl-storage-opt-env-'));
  try {
    const library = createMediaLibrary({
      env: { STORAGE_DIRECTORY: storageDirectory, TELEGRAM_MEDIA_ENABLED: 'false' },
      fetch: async function () { throw new Error('Unexpected Telegram request'); }
    });
    assert.deepEqual(await library.listApproved(), []);
    await fs.access(path.join(storageDirectory, 'media-index.json'));
    const restarted = createMediaLibrary({
      env: { STORAGE_DIRECTORY: storageDirectory, TELEGRAM_MEDIA_ENABLED: 'false' },
      fetch: async function () { throw new Error('Unexpected Telegram request'); }
    });
    assert.deepEqual(await restarted.listApproved(), []);
  } finally {
    await fs.rm(storageDirectory, { recursive: true, force: true });
  }
});

test('STORAGE_DIRECTORY: process.env.STORAGE_DIRECTORY works when options.env omitted', async function () {
  const storageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahl-storage-process-'));
  const previous = process.env.STORAGE_DIRECTORY;
  process.env.STORAGE_DIRECTORY = storageDirectory;
  try {
    const library = createMediaLibrary({
      fetch: async function () { throw new Error('Unexpected Telegram request'); }
    });
    assert.deepEqual(await library.listApproved(), []);
    await fs.access(path.join(storageDirectory, 'media-index.json'));
  } finally {
    if (previous === undefined) delete process.env.STORAGE_DIRECTORY;
    else process.env.STORAGE_DIRECTORY = previous;
    await fs.rm(storageDirectory, { recursive: true, force: true });
  }
});

test('STORAGE_DIRECTORY: default storage/ behavior remains backward compatible', async function () {
  const previous = process.env.STORAGE_DIRECTORY;
  delete process.env.STORAGE_DIRECTORY;
  try {
    const library = createMediaLibrary({
      env: { TELEGRAM_MEDIA_ENABLED: 'false' },
      fetch: async function () { throw new Error('Unexpected Telegram request'); }
    });
    assert.deepEqual(await library.listApproved(), []);
    await fs.access(path.join(__dirname, '..', 'storage', 'media-index.json'));
  } finally {
    if (previous === undefined) delete process.env.STORAGE_DIRECTORY;
    else process.env.STORAGE_DIRECTORY = previous;
  }
});

test('STORAGE_DIRECTORY: blank or whitespace-only value falls back safely', async function () {
  const previous = process.env.STORAGE_DIRECTORY;
  delete process.env.STORAGE_DIRECTORY;
  try {
    const library = createMediaLibrary({
      env: { STORAGE_DIRECTORY: '   ', TELEGRAM_MEDIA_ENABLED: 'false' },
      fetch: async function () { throw new Error('Unexpected Telegram request'); }
    });
    assert.deepEqual(await library.listApproved(), []);
    await fs.access(path.join(__dirname, '..', 'storage', 'media-index.json'));
    await assert.rejects(fs.access(path.join(process.cwd(), '   ')), function (error) {
      return error && error.code === 'ENOENT';
    });
  } finally {
    if (previous === undefined) delete process.env.STORAGE_DIRECTORY;
    else process.env.STORAGE_DIRECTORY = previous;
  }
});

test('STORAGE_DIRECTORY: invalid/unwritable path fails clearly and safely', async function () {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'ahl-storage-bad-'));
  const blocker = path.join(parent, 'not-a-directory');
  await fs.writeFile(blocker, 'x', 'utf8');
  try {
    const library = createMediaLibrary({
      env: { TELEGRAM_MEDIA_ENABLED: 'false' },
      fetch: async function () { throw new Error('Unexpected Telegram request'); },
      storageDirectory: path.join(blocker, 'child')
    });
    await assert.rejects(library.listApproved(), function (error) {
      return error && (error.code === 'ENOTDIR' || error.code === 'EEXIST' || error.code === 'ENOENT');
    });
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test('R2 storage: upload verifies object via injected MemoryStore', async function () {
  const storageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahl-r2-test-'));
  const storage = new MemoryStore();
  const fetch = async function (url) {
    if (url.includes('/getFile')) return telegramResponse({ file_path: 'documents/lesson.mp3' });
    if (url.includes('/getChatMember')) return telegramResponse({ status: 'administrator' });
    if (url.includes('/sendMessage')) return telegramResponse({ message_id: 101 });
    if (url.includes('/answerCallbackQuery')) return telegramResponse(true);
    if (url.includes('/editMessageText')) return telegramResponse({ message_id: 101 });
    if (url.includes('/file/bot')) return { ok: true, arrayBuffer: async function () { return Buffer.from('audio bytes'); } };
    throw new Error('Unexpected mocked Telegram request');
  };
  const env = { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_MEDIA_ENABLED: 'false', TELEGRAM_MEDIA_GROUP_ID: '-100123' };
  try {
    const library = createMediaLibrary({ env: env, fetch: fetch, storageDirectory: storageDirectory, storage: storage });
    await library.processUpdate({
      update_id: 1,
      message: { chat: { id: -100123 }, date: 1793500000, caption: 'درس الخميس #كتب', document: { file_id: 'a', file_unique_id: 'u', file_name: 'lesson.mp3', mime_type: 'audio/mpeg', file_size: 11 } }
    });
    // verify: object stored via R2 adapter, not on disk
    const keys = await storage.listKeys('');
    assert.equal(keys.length, 1);
    assert.ok(keys[0].endsWith('.mp3'));
    // approve -> served from R2 memory
    const index = JSON.parse(await fs.readFile(path.join(storageDirectory, 'media-index.json'), 'utf8'));
    const itemId = index.items[0].id;
    // pull callback data from fetch log via re-run? need id. Simulate approval directly via stored index? Instead use getApprovedFile after pushing through processUpdate callback: build callback_data
    // Simpler: approve via direct manipulation is not possible; use callback with id
    await library.processUpdate({
      update_id: 2,
      callback_query: { id: 'cb', data: 'media:approve:' + itemId, from: { id: 7 }, message: { message_id: 101, chat: { id: -100123 } } }
    });
    assert.equal((await library.listApproved()).length, 1);
    const file = await library.getApprovedFile(itemId);
    assert.equal(file.data.toString('utf8'), 'audio bytes');
    assert.equal(file.item.mimeType, 'audio/mpeg');
  } finally {
    await fs.rm(storageDirectory, { recursive: true, force: true });
  }
});

test('R2 storage: approval pending file delete uses storage.delete', async function () {
  const storageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahl-r2-del-'));
  const storage = new MemoryStore();
  const fetch = async function (url) {
    if (url.includes('/getFile')) return telegramResponse({ file_path: 'documents/lesson.mp3' });
    if (url.includes('/getChatMember')) return telegramResponse({ status: 'administrator' });
    if (url.includes('/sendMessage')) return telegramResponse({ message_id: 101 });
    if (url.includes('/answerCallbackQuery')) return telegramResponse(true);
    if (url.includes('/editMessageText')) return telegramResponse({ message_id: 101 });
    if (url.includes('/file/bot')) return { ok: true, arrayBuffer: async function () { return Buffer.from('audio bytes'); } };
    throw new Error('Unexpected mocked Telegram request');
  };
  const env = { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_MEDIA_ENABLED: 'false', TELEGRAM_MEDIA_GROUP_ID: '-100123' };
  try {
    const library = createMediaLibrary({ env: env, fetch: fetch, storageDirectory: storageDirectory, storage: storage });
    await library.processUpdate({ update_id: 1, message: { chat: { id: -100123 }, caption: 'درس جديد', document: { file_id: 'a', file_unique_id: 'u', file_name: 'lesson.mp3', file_size: 11 } } });
    const index = JSON.parse(await fs.readFile(path.join(storageDirectory, 'media-index.json'), 'utf8'));
    const itemId = index.items[0].id;
    await library.processUpdate({ update_id: 2, callback_query: { id: 'cb', data: 'media:reject:' + itemId, from: { id: 7 }, message: { message_id: 101, chat: { id: -100123 } } } });
    assert.deepEqual(await storage.listKeys(''), []);
  } finally {
    await fs.rm(storageDirectory, { recursive: true, force: true });
  }
});
