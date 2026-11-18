(function () {
  'use strict';
  var root, panel, log, input, form, quick, toggle, closeButton;
  var sectionNames = {
    sched: 'جدول الدروس', prayers: 'مواقيت الصلاة', qibla: 'اتجاه القبلة',
    adhkar: 'الأذكار', media: 'المكتبة العلمية', q: 'الأسئلة الشرعية',
    about: 'عن المجلس', account: 'حسابي'
  };
  var shortcuts = [
    ['الجدول','sched'],['المكتبة','media'],['الصلاة','prayers'],
    ['الأذكار','adhkar'],['القبلة','qibla'],['حسابي','account']
  ];
  function node(tag, cls, value) {
    var el=document.createElement(tag); if(cls) el.className=cls;
    if(value) el.textContent=value; return el;
  }
  function activeSection() {
    var ids=Object.keys(sectionNames);
    for(var i=0;i<ids.length;i++){
      var el=document.getElementById(ids[i]);
      if(el && !el.hidden) return ids[i];
    }
    return 'sched';
  }
  function addMessage(value, who) {
    var item=node('div','haress-assistant-msg '+who,value);
    item.setAttribute('dir','auto'); log.appendChild(item); log.scrollTop=log.scrollHeight;
  }
  function go(id) {
    var target=document.getElementById(id);
    if(id==='sched') { if(typeof window.show==='function') window.show('sched'); }
    else {
      var tab=document.querySelector('[onclick*="show(\\''+id+'\\')"]');
      if(tab) tab.click();
      else if(typeof window.show==='function') window.show(id);
    }
    if(target) target.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  }
  function answer(raw) {
    var q=raw.trim().toLowerCase();
    if(!q) return;
    addMessage(raw,'user');
    var id=activeSection(), reply, destination;
    if(/^(مرحبا|السلام|اهلا|أهلا|سلام)/.test(q)) {
      reply='وعليكم السلام ورحمة الله وبركاته. أهلًا بك في استراحة أهل الأثر. أستطيع إرشادك إلى أقسام المنصة ومساعدتك في الوصول إلى الخدمات.';
    } else if(/مكتب|مكتبة|كتاب|صوت|فيديو|محاض|درس مسجل/.test(q)) {
      reply='يمكنك تصفح المواد الصوتية والمرئية والكتب من قسم المكتبة العلمية.'; destination='media';
    } else if(/صلاة|مواقيت|اذان|أذان/.test(q)) {
      reply='افتح قسم الصلاة لعرض المواقيت وضبط طريقة الحساب والموقع بإذنك.'; destination='prayers';
    } else if(/قبلة|الكعب|اتجاه/.test(q)) {
      reply='قسم القبلة يعرض اتجاه القبلة، وقد يحتاج إلى إذن الموقع ومستشعر الاتجاه.'; destination='qibla';
    } else if(/ذكر|اذكار|أذكار|الصباح|المساء/.test(q)) {
      reply='قسم الأذكار يتيح أذكار الصباح والمساء وحفظ تقدمك على هذا الجهاز.'; destination='adhkar';
    } else if(/حساب|دخول|تسجيل|بريد|كلمة المرور/.test(q)) {
      reply='من قسم حسابي يمكنك إنشاء حساب أو تسجيل الدخول ببريدك الإلكتروني.'; destination='account';
    } else if(/سؤال شرعي|فتوى|حكم شرعي|حديث|دليل/.test(q)) {
      reply='للسؤال الشرعي استخدم قسم الأسئلة. سيُرسل السؤال بموافقتك إلى مسار المراجعة، وأي مسودة آلية تظل غير معتمدة حتى يراجعها الدكتور خالد. لا أقدّم فتاوى.'; destination='q';
    } else if(/جدول|موعد|متى|دروس|مجالس/.test(q)) {
      reply='جدول الدروس ومواعيد المجالس موجود في الصفحة الرئيسية ضمن جدول هذا الأسبوع.'; destination='sched';
    } else {
      reply='أنا مرشد تجريبي داخل المنصة، وأساعدك حاليًا في الوصول إلى الأقسام والخدمات، ولا أختلق إجابات علمية. أخبرني: هل تبحث عن المكتبة، الصلاة، الأذكار، القبلة، جدول الدروس، أم حسابك؟';
    }
    addMessage(reply,'bot');
    if(destination) {
      var action=node('button','haress-assistant-quick-action','افتح '+sectionNames[destination]);
      action.type='button'; action.addEventListener('click',function(){go(destination);});
      var wrapper=node('div','haress-assistant-quick'); wrapper.appendChild(action); log.appendChild(wrapper); log.scrollTop=log.scrollHeight;
    }
  }
  function mount() {
    if(document.getElementById('haressAssistant')) return;
    root=node('div','haress-assistant'); root.id='haressAssistant';
    toggle=node('button','haress-assistant-toggle','المساعد والمرشد');
    toggle.type='button'; toggle.setAttribute('aria-expanded','false'); toggle.setAttribute('aria-controls','haressAssistantPanel');
    panel=node('section','haress-assistant-panel'); panel.id='haressAssistantPanel'; panel.hidden=true;
    var head=node('div','haress-assistant-head'), title=node('div','');
    title.append(node('strong','','مرشد استراحة أهل الأثر'),node('small','','نسخة تجريبية — إرشاد الأقسام'));
    closeButton=node('button','haress-assistant-close','إغلاق'); closeButton.type='button';
    head.append(title,closeButton);
    log=node('div','haress-assistant-log'); log.setAttribute('role','log'); log.setAttribute('aria-live','polite');
    addMessage('مرحبًا بك. أنا مرشد تجريبي أساعدك في التنقل داخل المنصة. لا أقدّم فتاوى أو إجابات علمية معتمدة.','bot');
    var note=node('p','haress-assistant-meta','الإرشاد هنا محلي داخل المتصفح، ولا تُرسل رسائلك إلى خدمة ذكاء اصطناعي.');
    quick=node('div','haress-assistant-quick');
    shortcuts.forEach(function(entry){
      var b=node('button','',entry[0]); b.type='button';
      b.addEventListener('click',function(){addMessage(entry[0],'user');addMessage('سأفتح لك قسم '+sectionNames[entry[1]]+'.','bot');go(entry[1]);});
      quick.appendChild(b);
    });
    form=node('form','haress-assistant-form');
    input=node('input','haress-assistant-input'); input.type='text'; input.maxLength=240;
    input.placeholder='اكتب ما الذي تبحث عنه…'; input.setAttribute('aria-label','اكتب سؤالك عن استخدام المنصة');
    var send=node('button','haress-assistant-send','إرسال'); send.type='submit';
    form.append(input,send);
    form.addEventListener('submit',function(event){event.preventDefault();var value=input.value;input.value='';answer(value);});
    closeButton.addEventListener('click',close);
    toggle.addEventListener('click',function(){var opening=panel.hidden;panel.hidden=!opening;toggle.setAttribute('aria-expanded',String(opening));if(opening)input.focus();});
    panel.append(head,log,note,quick,form); root.append(toggle,panel); document.body.appendChild(root);
  }
  function close(){panel.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount,{once:true}); else mount();
})();
