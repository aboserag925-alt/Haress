(function(){
  'use strict';
  var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce)return;
  try{if(sessionStorage.getItem('ahl-athar-brand-intro-seen')==='1')return;sessionStorage.setItem('ahl-athar-brand-intro-seen','1');}catch(_){}
  function show(){
    if(!document.body||document.querySelector('.haress-intro'))return;
    var layer=document.createElement('div');
    layer.className='haress-intro';
    layer.setAttribute('aria-hidden','true');
    var content=document.createElement('div');
    content.className='haress-intro__content';
    var img=document.createElement('img');
    img.className='haress-intro__logo';
    img.alt='';
    // استخدم icon.svg المحلي الصحيح (أهل الأثر) بدل أي علامة قديمة
    img.src='icon.svg';
    // fallback عند غياب الأيقونة: إخفاء الصورة دون كسر الصفحة
    img.onerror=function(){img.style.display='none';};
    var name=document.createElement('div');
    name.className='haress-intro__name';
    name.textContent='إستراحة أهل الأثر';
    var tag=document.createElement('div');
    tag.className='haress-intro__tag';
    tag.textContent='علم شرعي بمنهج أهل السنة';
    content.appendChild(img);
    content.appendChild(name);
    content.appendChild(tag);
    layer.appendChild(content);
    document.body.appendChild(layer);
    window.setTimeout(function(){layer.classList.add('is-leaving');},1250);
    window.setTimeout(function(){if(layer.parentNode)layer.parentNode.removeChild(layer);},1750);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',show,{once:true});else show();
})();
