(function () {
  'use strict';
  var host = document.getElementById('bookItems');
  var status = document.getElementById('booksStatus');
  if (!host) return;
  var books = [];
  var loaded = false;
  function currentFilters() {
    return {
      query: document.getElementById('librarySearch') ? document.getElementById('librarySearch').value : '',
      category: document.getElementById('libraryCategoryFilter') ? document.getElementById('libraryCategoryFilter').value : 'all',
      sheikh: document.getElementById('librarySheikhFilter') ? document.getElementById('librarySheikhFilter').value : 'all',
      sort: document.getElementById('librarySort') ? document.getElementById('librarySort').value : 'newest'
    };
  }
  function render(filters) {
    filters = filters || currentFilters();
    host.replaceChildren();
    var H = window.HaressLibraryMedia;
    var query = H ? H.text(filters.query) : String(filters.query || '').trim().toLocaleLowerCase('ar');
    var visible = books.filter(function (book) {
      if (filters.category && filters.category !== 'all' && filters.category !== 'books') return false;
      if (filters.sheikh && filters.sheikh !== 'all') return false;
      var fields = [book.title, book.scope, book.description, book.author, book.sheikh, 'كتب PDF'];
      return !query || fields.some(function (value) {
        var text = H ? H.text(value) : String(value || '').trim().toLocaleLowerCase('ar');
        return text.includes(query);
      });
    });
    if (filters.sort === 'name') visible.sort(function (a, b) { return String(a.title || '').localeCompare(String(b.title || ''), 'ar'); });
    if (!visible.length) {
      if (status) status.textContent = loaded ? (books.length ? 'لا توجد كتب تطابق البحث أو التصفية.' : 'لا توجد كتب منشورة حاليًا.') : 'جارٍ تحميل الكتب…';
      return;
    }
    if (status) status.textContent = 'عدد الكتب: ' + visible.length;
    visible.forEach(function (book) {
      var card = document.createElement('article'); card.className = 'v3-library-entry';
      var title = document.createElement('h3'); title.textContent = book.title || 'كتاب علمي';
      var meta = document.createElement('p'); meta.className = 'library-card-meta';
      meta.textContent = 'الشيخ: ' + (book.sheikh || book.author || 'غير محدد') + ' · التصنيف: كتب PDF · المدة: لا تنطبق · النوع: كتاب PDF';
      var scope = document.createElement('p'); scope.textContent = book.scope || book.description || '';
      var details = document.createElement('p'); details.textContent = (book.pages || '—') + ' صفحة مصورة · ' + (Array.isArray(book.parts) ? book.parts.length : 0) + ' أجزاء للعرض والتحميل';
      var link = document.createElement('a'); link.className = 'outline-action'; link.href = '/books-reader.html?id=' + encodeURIComponent(book.id);
      link.textContent = 'قراءة PDF داخل المكتبة';
      card.append(title, meta, scope, details, link); host.appendChild(card);
    });
  }
  window.HaressBooksRender = render;
  ['librarySearch', 'libraryCategoryFilter', 'librarySheikhFilter', 'librarySort'].forEach(function (id) {
    var control = document.getElementById(id);
    if (control) control.addEventListener(id === 'librarySearch' ? 'input' : 'change', function () { render(); });
  });
  fetch('/books.json', { method: 'GET', credentials: 'omit', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
    .then(function (response) { if (!response.ok) throw new Error('Book index request failed'); return response.json(); })
    .then(function (result) {
      if (!Array.isArray(result)) throw new Error('Invalid book index');
      books = result; loaded = true; render();
    })
    .catch(function () { if (status) status.textContent = 'تعذر تحميل فهرس الكتب الآن.'; });
})();
