// عنوان واجهة برمجة التطبيقات الذي يستدعي منه المتصفح.
// سلسلة فارغة ("") تعني المنشأ نفسه (same-origin)، وذلك عندما يعمل موقع الاستراحة
// خلف وكيل Cloudflare Worker: يتصل المتصفح بـ /api/* على المضيف نفسه (الWorker)،
// ويقوم الوكيل بتحويل الطلب إلى الخادم الخلفي عبر متغير الربط API_BACKEND_URL.
// لا تُضَع عنوان خدمة إنتاجية ثابتة (مثل Railway) هنا؛ ذلك سيجعل معاينة (Preview)
// تستدعي خادم إنتاج Production.
//
// عنوان الخادم الخلفي يُحقن منفصلاً لكل بيئة عبر wrangler (API_BACKEND_URL)،
// ما يضمن فصلاً صريحاً بين معاينة Preview والإنتاج Production.
window.AHL_API_BASE_URL = '';

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
      var options = {};
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
