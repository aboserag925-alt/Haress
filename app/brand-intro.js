(function(){
  'use strict';
  var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce)return;
  try{if(sessionStorage.getItem('haress-brand-intro-seen')==='1')return;sessionStorage.setItem('haress-brand-intro-seen','1');}catch(_){}
  function show(){
    if(!document.body||document.querySelector('.haress-intro'))return;
    var layer=document.createElement('div');
    layer.className='haress-intro';
    layer.setAttribute('aria-hidden','true');
    layer.innerHTML='<div class="haress-intro__content"><img class="haress-intro__logo" alt="" src="../assets/brand-mark-light.svg"><div class="haress-intro__name">استراحة أهل الأثر</div><div class="haress-intro__tag">علم شرعي بمنهج أهل السنة</div></div>';
    document.body.appendChild(layer);
    window.setTimeout(function(){layer.classList.add('is-leaving');},1250);
    window.setTimeout(function(){if(layer.parentNode)layer.parentNode.removeChild(layer);},1750);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',show,{once:true});else show();
})();
