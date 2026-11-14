window.AHL_API_BASE_URL = 'https://haress-production.up.railway.app';

/* Library loading guard: never leave the library on "loading" forever.
   Replaces loadMediaLibrary after app.js has loaded. */
window.addEventListener('load', function () {
  if (typeof window.loadMediaLibrary !== 'function' || typeof window.apiUrl !== 'function') return;
  window.loadMediaLibrary = async function loadMediaLibrary() {
    var status = document.getElementById('mediaStatus');
    if (!status) return;
    status.className = 'status';
    status.textContent = 'جارٍ تحميل المكتبة…';
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;
    try {
      var options = { cache: 'no-store' };
      if (controller) options.signal = controller.signal;
      var response = await fetch(window.apiUrl('/api/library'), options);
      var text = new TextDecoder('utf-8', { fatal: true }).decode(await response.arrayBuffer());
      var result = JSON.parse(text);
      if (!response.ok || !Array.isArray(result.items)) {
        throw new Error('invalid');
      }
      window.mediaItems = result.items;
      try { mediaItems = result.items; } catch (e) {}
      window.renderMediaLibrary();
    } catch (error) {
      status.textContent = error && error.name === 'AbortError'
        ? 'انتهت مهلة الاتصال بالخادم. جرّب فتح المكتبة مرة أخرى.'
        : error instanceof TypeError
          ? 'تعذر الاتصال بالخادم لتحميل المكتبة.'
          : 'تعذر تحميل المكتبة الآن. حاول مرة أخرى.';
      status.classList.add('error');
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
});
