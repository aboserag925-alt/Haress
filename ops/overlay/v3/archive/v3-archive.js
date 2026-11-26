(function () {
  'use strict';
  /* Scientific archive: subjects, explanations (current/completed), linked media, rebuttals. */
  var $ = function (id) { return document.getElementById(id); };
  var apiBase = String(window.AHL_API_BASE_URL || '').replace(/\/+$/, '');
  var PROGRESS = { unknown: 'الحالة غير محددة', ongoing: 'جارٍ شرحه الآن', completed: 'تم شرحه كاملًا', planned: 'قريبًا' };
  var PLATFORM = { youtube: 'يوتيوب', tiktok: 'تيك توك', facebook: 'فيسبوك', other: 'رابط' };
  var TYPE = { audio: 'صوتي', video: 'مرئي', transcript: 'مكتوب / تفريغ', link: 'رابط' };
  var data = null;
  var view = { subject: 'all', progress: 'all', platform: 'all', mediaType: 'all', rebuttalType: 'all', rebuttalSubject: 'all' };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function status(id, message, error) {
    var node = $(id); if (!node) return;
    node.textContent = message; node.classList.toggle('error', !!error);
  }
  function safeHttps(value) {
    try { var url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch (e) { return ''; }
  }
  function chips(host, items, key, onChange) {
    host.replaceChildren();
    items.forEach(function (item) {
      var button = el('button', 'media-filter' + (view[key] === item[0] ? ' on' : ''), item[1]);
      button.type = 'button'; button.setAttribute('aria-pressed', String(view[key] === item[0]));
      button.addEventListener('click', function () { view[key] = item[0]; onChange(); });
      host.appendChild(button);
    });
  }

  function renderResource(resource) {
    var row = el('div', 'v3-resource v3-resource-' + resource.type);
    var label = el('span', 'v3-resource-type', TYPE[resource.type] || 'مادة');
    var title = el('b', '', resource.title || TYPE[resource.type] || 'مادة');
    row.append(label, title);
    if (resource.durationLabel) row.appendChild(el('p', 'v3-lesson-note', 'المدة: ' + resource.durationLabel));
    if (resource.sourceLabel) row.appendChild(el('p', 'v3-lesson-note', 'المصدر: ' + resource.sourceLabel));
    var source = window.HaressSourceLinks && window.HaressSourceLinks.parse(resource.url);
    var yt = source && window.HaressYouTube.parse(resource.url);
    if (resource.type === 'video' && yt && yt.video && window.HaressIntegratedVideo) {
      var play = el('button', 'outline-action', '▶ مشاهدة داخل حارس'); play.type = 'button';
      play.addEventListener('click', function(){ window.HaressIntegratedVideo.open({id:yt.video,title:resource.title || 'فيديو'}); });
      row.appendChild(play);
    } else if (source) {
      var action = resource.type === 'audio' ? 'استماع' : resource.type === 'video' ? 'مشاهدة' : 'فتح المادة';
      var link = el('a', 'outline-action', resource.type === 'audio' ? '▶ تشغيل التسجيل' : action + ' على ' + source.platform + ' ↗');
      if (resource.type === 'audio') { link.setAttribute('aria-label', 'تشغيل التسجيل، يفتح المصدر الأصلي على ' + source.platform + ' في نافذة جديدة'); link.style.display='block'; link.style.textAlign='center'; link.style.padding='16px'; link.style.background='#b49a69'; link.style.color='#181818'; link.style.textDecoration='none'; link.style.fontWeight='700'; }
      link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      row.appendChild(link);
      if (resource.type === 'audio') row.appendChild(el('p', 'v3-lesson-note', 'يفتح من المصدر الأصلي ↗ • ' + source.platform));
      row.appendChild(el('p', 'v3-lesson-note', source.access));
    } else {
      row.appendChild(el('p', 'v3-lesson-note v3-empty', 'رابط الأصل غير متاح أو لم يُتحقق منه بعد. لا يوجد تشغيل أو تنزيل من الموقع.'));
    }
    if (resource.transcript) {
      var details = el('details', 'v3-transcript');
      details.appendChild(el('summary', '', 'قراءة النص المتاح'));
      details.appendChild(el('p', '', resource.transcript));
      row.appendChild(details);
    }
    return row;
  }

  function renderLesson(lesson) {
    var article = el('details', 'v3-lesson v3-lesson-' + lesson.progress);
    var summary = el('summary');
    summary.append(el('b', '', lesson.title), el('span', 'v3-badge v3-badge-' + lesson.progress, PROGRESS[lesson.progress] || ''));
    article.appendChild(summary);
    if (lesson.description) article.appendChild(el('p', 'v3-lesson-note', lesson.description));
    if (lesson.resources.length) {
      var list = el('div', 'v3-resources');
      lesson.resources.forEach(function (resource) { list.appendChild(renderResource(resource)); });
      article.appendChild(list);
    } else {
      article.appendChild(el('p', 'v3-lesson-note v3-empty', 'لم تُرفع مواد هذا الشرح بعد.'));
    }
    return article;
  }

  function renderArchive() {
    var host = $('archiveItems'); if (!host || !data) return;
    chips($('archiveSubjectFilters'), [['all', 'كل الأقسام']].concat(data.subjects.map(function (s) { return [s.id, s.title]; })), 'subject', renderArchive);
    chips($('archiveProgressFilters'), [['all', 'الكل'], ['ongoing', PROGRESS.ongoing], ['completed', PROGRESS.completed], ['planned', PROGRESS.planned], ['unknown', PROGRESS.unknown]], 'progress', renderArchive);
    chips($('archiveMediaFilters'), [['all', 'كل المواد'], ['video', 'مرئيات'], ['audio', 'صوتيات'], ['transcript', 'مكتوبات'], ['link', 'روابط']], 'mediaType', renderArchive);
    host.replaceChildren();
    var shown = 0;
    data.subjects.forEach(function (subject) {
      if (view.subject !== 'all' && view.subject !== subject.id) return;
      var lessons = subject.lessons.filter(function (l) { return (view.progress === 'all' || l.progress === view.progress) && (view.mediaType === 'all' || l.resources.some(function(r){return r.type === view.mediaType;})); });
      if (!lessons.length && (view.progress !== 'all' || view.mediaType !== 'all')) return;
      shown++;
      var section = el('section', 'v3-subject');
      var head = el('header', 'v3-subject-head');
      head.appendChild(el('h3', '', subject.title));
      var rc = data.rebuttals.filter(function (r) { return r.subject_id === subject.id; }).length;
      head.appendChild(el('p', 'v3-subject-count', subject.counts.total + ' شرح · ' + rc + ' رد'));
      section.appendChild(head);
      if (subject.description) section.appendChild(el('p', 'v3-lesson-note', subject.description));
      if (rc) {
        var go = el('button', 'outline-action v3-go-rebuttals', 'عرض الردود في هذا القسم (' + rc + ')'); go.type = 'button';
        go.addEventListener('click', function () { view.rebuttalSubject = subject.id; view.platform = 'all'; view.rebuttalType = 'all'; renderRebuttals(); var t = $('rebuttals'); if (t) { t.hidden = false; t.scrollIntoView(); } });
        section.appendChild(go);
      }
      if (!lessons.length && !rc) section.appendChild(el('p', 'v3-lesson-note v3-empty', 'لا توجد شروح منشورة في هذا القسم بعد.'));
      lessons.forEach(function (lesson) { var visible = Object.assign({}, lesson, {resources:lesson.resources.filter(function(r){return view.mediaType === 'all' || r.type === view.mediaType;})}); section.appendChild(renderLesson(visible)); });
      host.appendChild(section);
    });
    status('archiveStatus', shown ? 'عدد الأقسام: ' + shown : (data.subjects.length ? 'لا توجد شروح بهذه الحالة.' : 'لا توجد أقسام منشورة بعد.'));
  }

  function renderRebuttals() {
    var host = $('rebuttalItems'); if (!host || !data) return;
    var platforms = [['all', 'الكل']];
    Object.keys(PLATFORM).forEach(function (key) {
      if (data.rebuttals.some(function (r) { return r.platform === key; })) platforms.push([key, PLATFORM[key]]);
    });
    chips($('rebuttalFilters'), platforms, 'platform', renderRebuttals);
    chips($('rebuttalMediaFilters'), [['all', 'كل المواد'], ['video', 'مرئيات'], ['audio', 'صوتيات'], ['transcript', 'مكتوبات'], ['link', 'روابط']], 'rebuttalType', renderRebuttals);
    var withR = data.subjects.filter(function (sub) { return data.rebuttals.some(function (r) { return r.subject_id === sub.id; }); });
    var sf = $('rebuttalSubjectFilters');
    if (sf) chips(sf, [['all', 'كل الأقسام']].concat(withR.map(function (x) { return [x.id, x.title]; })), 'rebuttalSubject', renderRebuttals);
    host.replaceChildren();
    var items = data.rebuttals.filter(function (r) { return (view.platform === 'all' || r.platform === view.platform) && (view.rebuttalType === 'all' || r.type === view.rebuttalType) && (view.rebuttalSubject === 'all' || r.subject_id === view.rebuttalSubject); });
    var names = {}; data.subjects.forEach(function (s) { names[s.id] = s.title; });
    items.forEach(function (item) {
      var href = item.url ? safeHttps(item.url) : '';
      var article = el('article', 'v3-library-entry v3-rebuttal');
      article.appendChild(el('span', '', PLATFORM[item.platform] || 'رابط'));
      article.appendChild(el('h3', '', item.title));
      if (item.summary) article.appendChild(el('p', 'v3-lesson-note', item.summary));
      if (item.subject_id && names[item.subject_id]) article.appendChild(el('time', '', 'القسم: ' + names[item.subject_id]));
      article.appendChild(renderResource({type:item.type || 'link',title:item.title,url:href,transcript:item.transcript,media:item.media}));
      host.appendChild(article);
    });
    status('rebuttalStatus', items.length ? 'عدد الردود: ' + items.length : (data.rebuttals.length ? 'لا توجد ردود على هذه المنصة.' : 'لا توجد ردود منشورة بعد.'));
  }

  async function load() {
    status('archiveStatus', 'جارٍ تحميل الأقسام…'); status('rebuttalStatus', 'جارٍ تحميل الردود…');
    try {
      var response = await fetch('/v3/archive/archive-data.json', { cache: 'no-store' });
      var result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await response.arrayBuffer()));
      if (!response.ok || !Array.isArray(result.subjects) || !Array.isArray(result.rebuttals)) throw new Error('invalid');
      data = result; renderArchive(); renderRebuttals();
    } catch (e) {
      status('archiveStatus', 'تعذر تحميل الأقسام الآن. حاول مرة أخرى.', true);
      status('rebuttalStatus', 'تعذر تحميل الردود الآن. حاول مرة أخرى.', true);
    }
  }
  window.HaressV3Archive = { load: load, render: function (next) { data = next; renderArchive(); renderRebuttals(); } };
})();
