'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { once } = require('node:events');
const { setTimeout: sleep } = require('node:timers/promises');
const { createServer } = require('./index');

test('aborted question request does not crash the server', async (t) => {
  const env = { NODE_ENV: 'development', TELEGRAM_BOT_TOKEN: 'fake',
    TELEGRAM_CHAT_ID: '1', TELEGRAM_QUESTIONS_CHAT_ID: '1' };
  const server = createServer({ env });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const host = '127.0.0.1:' + server.address().port;
  env.ALLOWED_ORIGINS = 'http://' + host;

  const socket = net.connect(server.address().port, '127.0.0.1');
  await once(socket, 'connect');
  const received = once(server, 'request');
  socket.write('POST /api/questions HTTP/1.1\r\nHost: ' + host +
    '\r\nOrigin: http://' + host + '\r\nContent-Type: application/json' +
    '\r\nContent-Length: 100\r\n\r\n{"q');
  await received;
  socket.destroy();
  await sleep(500);

  const res = await fetch('http://' + host + '/api/questions');
  assert.strictEqual(res.status, 405);
});
