import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildCloudflare } from './build-cloudflare.mjs';
import { mkdir, stat, rm, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const appIndex = join(root, 'app', 'index.html');
const workerEntry = join(root, 'src', 'worker', 'index.js');
const runtimeConfig = join(root, 'app', 'runtime-config.js');
const wranglerConfig = join(root, 'wrangler.jsonc');

describe('scripts/build-cloudflare.mjs', () => {
  before(async () => {
    await rm(join(root, 'dist'), { recursive: true, force: true });
  });

  after(async () => {
    await rm(join(root, 'dist'), { recursive: true, force: true });
  });

  it('ينشئ dist/ من app/ والعامل دون حذف ملفات المصدر', async () => {
    await buildCloudflare({ cleanDist: true });

    const appStill = await stat(appIndex);
    assert.ok(appStill.isFile(), 'app/index.html يجب أن يبقى');

    const workerStill = await stat(workerEntry);
    assert.ok(workerStill.isFile(), 'src/worker/index.js يجب أن يبقى');

    const distStat = await stat(join(root, 'dist'));
    assert.ok(distStat.isDirectory(), 'dist/ يجب أن يُنشأ');
  });

  it('لا يعدل ملفات الإعداد المحمية وقت التشغيل', async () => {
    const before = await readFile(runtimeConfig, 'utf8');
    await buildCloudflare({ cleanDist: true });
    const after = await readFile(runtimeConfig, 'utf8');
    assert.equal(before, after, 'runtime-config.js يجب ألا يتغير أثناء البناء');
  });

  it('يضبط Cloudflare Assets binding ومسار API في موضعهما الصحيح', async () => {
    const config = JSON.parse(await readFile(wranglerConfig, 'utf8'));
    assert.equal(config.main, 'src/worker/index.js');
    assert.equal(config.assets?.directory, './app');
    assert.equal(config.assets?.binding, 'ASSETS');
    assert.deepEqual(config.assets?.run_worker_first, ['/api/*']);
    assert.equal(config.rules, undefined, 'توجيه الأصول ليس من قواعد bundling');
  });

});
