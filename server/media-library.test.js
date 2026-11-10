'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createMediaLibrary } = require('./media-library');

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

test('Supabase storage: upload verifies via injected MemoryStore', async function () {
  const { MemoryStore: MS } = require('./media-storage');
  const storageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahl-sb-test-'));
  const storage = new MS();
  const fetch = async function (url) {
    if (url.includes('/getFile')) return { ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify({ ok: true, result: { file_path: 'documents/lesson.mp3' } })) };
    if (url.includes('/getChatMember')) return { ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify({ ok: true, result: { status: 'administrator' } })) };
    if (url.includes('/sendMessage')) return { ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify({ ok: true, result: { message_id: 101 } })) };
    if (url.includes('/answerCallbackQuery')) return { ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify({ ok: true, result: true })) };
    if (url.includes('/editMessageText')) return { ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify({ ok: true, result: { message_id: 101 } })) };
    if (url.includes('/file/bot')) return { ok: true, arrayBuffer: async () => Buffer.from('audio bytes') };
    throw new Error('Unexpected');
  };
  const env = { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_MEDIA_ENABLED: 'false', TELEGRAM_MEDIA_GROUP_ID: '-100123' };
  try {
    const library = createMediaLibrary({ env: env, fetch: fetch, storageDirectory: storageDirectory, storage: storage });
    await library.processUpdate({ update_id: 1, message: { chat: { id: -100123 }, date: 1793500000, caption: 'درس الخميس #كتب', document: { file_id: 'a', file_unique_id: 'u', file_name: 'lesson.mp3', mime_type: 'audio/mpeg', file_size: 11 } } });
    const keys = (await storage.listKeys('')).filter(key => key.startsWith('library/audio/'));
    assert.equal(keys.length, 1);
    assert.ok(keys[0].endsWith('lesson.mp3'));
    // The remote metadata index is stored separately from media objects.
    const id = keys[0].split('/')[2];
    assert.match(id, /^[0-9a-f-]{36}$/i);
    await library.processUpdate({ update_id: 2, callback_query: { id: 'cb', data: 'media:approve:' + id, from: { id: 7 }, message: { message_id: 101, chat: { id: -100123 } } } });
    assert.equal((await library.listApproved()).length, 1);
    const f = await library.getApprovedFile(id);
    assert.equal(f.data.toString('utf8'), 'audio bytes');
    assert.deepEqual((await storage.listKeys('')).filter(key => key.startsWith('library/audio/')), [keys[0]]);
  } finally {
    await fs.rm(storageDirectory, { recursive: true, force: true });
  }
});

test('Supabase storage: reject deletes remote object', async function () {
  const { MemoryStore: MS } = require('./media-storage');
  const storageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahl-sb-del-'));
  const storage = new MS();
  const fetch = async function (url) {
    if (url.includes('/getFile')) return { ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify({ ok: true, result: { file_path: 'documents/lesson.mp3' } })) };
    if (url.includes('/getChatMember')) return { ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify({ ok: true, result: { status: 'administrator' } })) };
    if (url.includes('/sendMessage')) return { ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify({ ok: true, result: { message_id: 101 } })) };
    if (url.includes('/answerCallbackQuery')) return { ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify({ ok: true, result: true })) };
    if (url.includes('/editMessageText')) return { ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify({ ok: true, result: { message_id: 101 } })) };
    if (url.includes('/file/bot')) return { ok: true, arrayBuffer: async () => Buffer.from('audio bytes') };
    throw new Error('Unexpected');
  };
  const env = { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_MEDIA_ENABLED: 'false', TELEGRAM_MEDIA_GROUP_ID: '-100123' };
  try {
    const library = createMediaLibrary({ env: env, fetch: fetch, storageDirectory: storageDirectory, storage: storage });
    await library.processUpdate({ update_id: 1, message: { chat: { id: -100123 }, caption: 'درس جديد', document: { file_id: 'a', file_unique_id: 'u', file_name: 'lesson.mp3', file_size: 11 } } });
    // after fix, Supabase mode does not write media-index.json locally
    await assert.rejects(fs.readFile(path.join(storageDirectory, 'media-index.json'), 'utf8'), { code: 'ENOENT' });
    const keys = (await storage.listKeys('')).filter(key => key.startsWith('library/audio/'));
    assert.equal(keys.length, 1);
    const id = keys[0].split('/')[2];
    assert.match(id, /^[0-9a-f-]{36}$/i);
    // clean: reject path also deletes
    await library.processUpdate({ update_id: 2, callback_query: { id: 'cb', data: 'media:reject:' + id, from: { id: 7 }, message: { message_id: 101, chat: { id: -100123 } } } });
    assert.deepEqual((await storage.listKeys('')).filter(key => key.startsWith('library/audio/')), []);
  } finally {
    await fs.rm(storageDirectory, { recursive: true, force: true });
  }
});

test('Supabase storage: listApproved works without local index file', async function () {
  const { MemoryStore: MS } = require('./media-storage');
  const storageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahl-sb-nofile-'));
  const storage = new MS();
  const env = { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_MEDIA_ENABLED: 'false', TELEGRAM_MEDIA_GROUP_ID: '-100123' };
  const fetch = async function () { throw new Error('no telegram'); };
  try {
    const library = createMediaLibrary({ env: env, fetch: fetch, storageDirectory: storageDirectory, storage: storage });
    assert.deepEqual(await library.listApproved(), []);
    // no files created on disk (root-owned volume simulated by empty dir)
    assert.deepEqual(await storage.listKeys(''), ['library/_index.json']);
  } finally {
    await fs.rm(storageDirectory, { recursive: true, force: true });
  }
});

// Regression (Railway EACCES): in remote mode the library must not touch the
// local storage directory at all. Point storageDirectory at a path that cannot
// be used as a directory (an existing file). If initialize()/save() tried
// fs.mkdir/writeFile here it would throw EEXIST/ENOTDIR/EACCES and break
// GET /api/library (500 in Railway where the volume root is owned by root
// and the app runs as node). In remote mode listApproved/processUpdate must
// succeed without any filesystem access.
test('Supabase storage: works when storage directory is unwritable (Railway EACCES)', async function () {
  const { MemoryStore: MS } = require('./media-storage');
  // A file, not a directory: fs.mkdir(filePath) would fail with EEXIST/ENOTDIR.
  // Using a file (instead of chmod 555) keeps the test portable to Windows
  // and to CI running as root, where read-only perms alone are not reliable.
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahl-sb-eacces-'));
  const notAValidDirectory = path.join(tmpDir, 'not-a-directory');
  await fs.writeFile(notAValidDirectory, 'blocking file', 'utf8');
  const storage = new MS();
  const env = { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_MEDIA_ENABLED: 'false', TELEGRAM_MEDIA_GROUP_ID: '-100123' };
  const fetch = async function (url) {
    if (url.includes('/getFile')) return { ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify({ ok: true, result: { file_path: 'documents/lesson.mp3' } })) };
    if (url.includes('/getChatMember')) return { ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify({ ok: true, result: { status: 'administrator' } })) };
    if (url.includes('/sendMessage')) return { ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify({ ok: true, result: { message_id: 101 } })) };
    if (url.includes('/answerCallbackQuery')) return { ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify({ ok: true, result: true })) };
    if (url.includes('/editMessageText')) return { ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify({ ok: true, result: { message_id: 101 } })) };
    if (url.includes('/file/bot')) return { ok: true, arrayBuffer: async () => Buffer.from('audio bytes') };
    throw new Error('Unexpected');
  };
  try {
    const library = createMediaLibrary({ env: env, fetch: fetch, storageDirectory: notAValidDirectory, storage: storage });
    // listApproved must resolve (GET /api/library -> 200, not 500)
    assert.deepEqual(await library.listApproved(), []);
    // processUpdate (upload path via storeFile/save) must not touch the fs either
    await library.processUpdate({ update_id: 1, message: { chat: { id: -100123 }, date: 1793500000, caption: 'درس الخميس #كتب', document: { file_id: 'a', file_unique_id: 'u', file_name: 'lesson.mp3', mime_type: 'audio/mpeg', file_size: 11 } } });
    const keys = (await storage.listKeys('')).filter(key => key.startsWith('library/audio/'));
    assert.equal(keys.length, 1);
    assert.ok(keys[0].endsWith('lesson.mp3'));
    const id = keys[0].split('/')[2];
    await library.processUpdate({ update_id: 2, callback_query: { id: 'cb', data: 'media:approve:' + id, from: { id: 7 }, message: { message_id: 101, chat: { id: -100123 } } } });
    assert.equal((await library.listApproved()).length, 1);
    const f = await library.getApprovedFile(id);
    assert.equal(f.data.toString('utf8'), 'audio bytes');
    // The blocking file must remain untouched and no media-index.json may appear
    assert.equal(await fs.readFile(notAValidDirectory, 'utf8'), 'blocking file');
    await assert.rejects(fs.readFile(path.join(notAValidDirectory, 'media-index.json'), 'utf8'));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Supabase storage: approved library index survives a simulated process restart',async function(){
 const {MemoryStore}=require('./media-storage');
 const storage=new MemoryStore();
 const calls=[];
 const fetch=async function(url,options){
  calls.push({url,options});
  if(url.includes('/getFile')) return {ok:true,arrayBuffer:async()=>Buffer.from(JSON.stringify({ok:true,result:{file_path:'documents/restart.mp3'}}))};
  if(url.includes('/getChatMember')) return {ok:true,arrayBuffer:async()=>Buffer.from(JSON.stringify({ok:true,result:{status:'administrator'}}))};
  if(url.includes('/sendMessage')) return {ok:true,arrayBuffer:async()=>Buffer.from(JSON.stringify({ok:true,result:{message_id:501}}))};
  if(url.includes('/answerCallbackQuery')) return {ok:true,arrayBuffer:async()=>Buffer.from(JSON.stringify({ok:true,result:true}))};
  if(url.includes('/editMessageText')) return {ok:true,arrayBuffer:async()=>Buffer.from(JSON.stringify({ok:true,result:{message_id:501}}))};
  if(url.includes('/file/bot')) return {ok:true,arrayBuffer:async()=>Buffer.from('remote audio bytes')};
  throw new Error('Unexpected mocked request');
 };
 const env={TELEGRAM_BOT_TOKEN:'test-token',TELEGRAM_MEDIA_ENABLED:'false',TELEGRAM_MEDIA_GROUP_ID:'-100123'};
 const first=createMediaLibrary({env,fetch,storage});
 await first.processUpdate({update_id:10,message:{chat:{id:-100123},from:{id:7},date:1793500000,caption:'درس الاستعادة #كتب',document:{file_id:'remote-file',file_unique_id:'remote-unique',file_name:'restart.mp3',mime_type:'audio/mpeg',file_size:18}}});
 const approval=calls.find(x=>x.url.includes('/sendMessage'));
 const payload=JSON.parse(approval.options.body);
 const callback=payload.reply_markup.inline_keyboard[0][0].callback_data;
 await first.processUpdate({update_id:11,callback_query:{id:'restart-callback',data:callback,from:{id:7},message:{message_id:501,chat:{id:-100123}}}});
 assert.equal((await first.listApproved()).length,1);
 assert.ok(await storage.get('library/_index.json'));
 // A new library instance represents a fresh Node.js process; only the same remote
 // object store survives, not the previous in-memory items array.
 const restarted=createMediaLibrary({env,fetch,storage});
 const restored=await restarted.listApproved();
 assert.equal(restored.length,1);
 assert.equal(restored[0].title,'درس الاستعادة');
 assert.equal(restored[0].objectKey,(await first.listApproved())[0].objectKey);
});
