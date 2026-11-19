/* V2-only theme and motion behavior. Never runs outside the V2 document root. */
(function(){
 'use strict';
 var root=document.documentElement;
 if(!root.classList.contains('identity-v2'))return;
 var key='haress-identity-v2-theme';
 var sun='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42 1.42"/></svg>';
 var moon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M20.5 14.2A8.7 8.7 0 0 1 9.8 3.5 8.9 8.9 0 1 0 20.5 14.2Z"/></svg>';
 var saved='light';
 try{saved=localStorage.getItem(key)||'light'}catch(_){}
 function apply(theme){
  var dark=theme==='dark';
  root.setAttribute('data-theme',dark?'dark':'light');
  var meta=root.querySelector('meta[name="theme-color"]');
  if(meta)meta.setAttribute('content',dark?'#101b16':'#f5f9f5');
  var btn=root.querySelector('.theme-toggle');
  if(btn){btn.innerHTML=(dark?sun:moon)+'<span>'+(dark?'الوضع النهاري':'الوضع الليلي')+'</span>';btn.setAttribute('aria-pressed',String(dark));btn.setAttribute('aria-label',dark?'التبديل إلى الوضع النهاري':'التبديل إلى الوضع الليلي');}
  try{localStorage.setItem(key,dark?'dark':'light')}catch(_){}
 }
 function mount(){
  var host=root.querySelector('.wrap > header');
  if(!host||root.querySelector('.theme-toggle'))return;
  var btn=document.createElement('button');
  btn.type='button';btn.className='theme-toggle';
  btn.addEventListener('click',function(){apply(root.getAttribute('data-theme')==='dark'?'light':'dark')});
  host.appendChild(btn);
  apply(root.getAttribute('data-theme')||saved);
 }
 function addMotion(){
  var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduced)return;
  var body=root.querySelector('body');
  if(body)body.classList.add('v2-motion-ready');
  var candidates=root.querySelectorAll('body > .wrap .card,body > .wrap .next,body > .wrap .section-heading');
  if('IntersectionObserver' in window){
   var io=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add('v2-visible');io.unobserve(entry.target)}})},{threshold:.08,rootMargin:'0px 0px -30px 0px'});
   candidates.forEach(function(el){io.observe(el)});
  }else candidates.forEach(function(el){el.classList.add('v2-visible')});
 }
 function showIntro(){
  var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduced||!document.body||root.querySelector('.haress-intro'))return;
  try{if(sessionStorage.getItem('haress-identity-v2-intro')==='1')return;sessionStorage.setItem('haress-identity-v2-intro','1')}catch(_){}
  var layer=document.createElement('div');
  layer.className='haress-intro';
  layer.setAttribute('aria-hidden','true');
  layer.innerHTML='<div class="haress-intro__content"><img class="haress-intro__logo" alt="" src="icon.svg"><div class="haress-intro__name">استراحة أهل الأثر</div><div class="haress-intro__tag">علم شرعي بمنهج أهل السنة</div></div>';
  document.body.appendChild(layer);
  window.setTimeout(function(){layer.classList.add('is-leaving')},1250);
  window.setTimeout(function(){if(layer.parentNode)layer.parentNode.removeChild(layer)},1750);
 }
 function start(){mount();addMotion();showIntro()}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
 else start();
})();
