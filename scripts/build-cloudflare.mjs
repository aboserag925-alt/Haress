import { mkdir, copyFile, readdir, stat, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const appDir = join(root, 'app');
const workerEntry = join(root, 'src', 'worker', 'index.js');
const distDir = join(root, 'dist');

// ملفات الإعداد وقت التشغيل التي لا يُسمح لسكريبت البناء بتعديلها.
const PROTECTED_APP_FILES = new Set(['runtime-config.js', 'supabase-config.js']);

async function copyRecursive(src, dest) {
  const entries = await readdir(src, { withFileTypes: true });
  await mkdir(dest, { recursive: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyRecursive(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

/**
 * تجهيز dist/ كمخرج بناء لـ Cloudflare Worker.
 * - ينسخ محتويات app/ إلى dist/ دون تعديل أي ملف مصدر.
 * - ينسخ مدخل Worker src/worker/index.js إلى dist/ للمرحلة.
 * - لا يمس أي ملف في app/ أو src/ أو الجذر، ولا يُحذف تعديل محلي.
 * - لا يكتب runtime-config.js أو supabase-config.js بقيم جديدة.
 */
export async function buildCloudflare(options = {}) {
  const { cleanDist = true } = options;

  const appStat = await stat(appDir).catch(() => null);
  if (!appStat || !appStat.isDirectory()) {
    throw new Error('مجلد الأصول app/ غير موجود؛ لا يمكن البناء.');
  }
  const workerStat = await stat(workerEntry).catch(() => null);
  if (!workerStat || !workerStat.isFile()) {
    throw new Error('مدخل Worker src/worker/index.js غير موجود؛ لا يمكن البناء.');
  }

  // إعادة إنشاء dist/ كمخرج بناء فقط. الملفات المصدر في app/ و src/ remain intact.
  if (cleanDist) {
    await rm(distDir, { recursive: true, force: true });
  }
  await mkdir(distDir, { recursive: true });

  // نسخ أصول التطبيق إلى dist/ دون تعديل أي ملف محلي.
  await copyRecursive(appDir, distDir);

  // نسخ مدخل worker إلى dist/ للمرحلة.
  await mkdir(join(distDir, 'src', 'worker'), { recursive: true });
  await copyFile(workerEntry, join(distDir, 'src', 'worker', 'index.js'));

  // التحقق من أن ملفات الإعداد المحمية ما زالت موجودة وغير فارغة بعد البناء.
  for (const name of PROTECTED_APP_FILES) {
    const p = join(distDir, name);
    const s = await stat(p).catch(() => null);
    if (!s || !s.isFile() || s.size === 0) {
      throw new Error(`ملف الإعداد المحمي مفقود أو فارغ بعد البناء: ${name}`);
    }
  }

  return {
    distDir,
    message: 'تم تجهيز dist/ للبناء Cloudflare Worker دون فقدان أي ملف مصدر.'
  };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  buildCloudflare().then((result) => {
    console.log(result.message);
    console.log('dist at:', result.distDir);
  }).catch((error) => {
    console.error('BUILD FAILED:', error.message);
    process.exit(1);
  });
}
