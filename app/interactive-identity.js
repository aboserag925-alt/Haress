/* Accessible theme switch and lightweight motion enhancements. */
(function(){
 'use strict';
 var key='hares-ui-theme';
 var root=document.documentElement;
 var sun='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>';
 var moon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M20.5 14.2A8.7 8.7 0 0 1 9.8 3.5 8.9 8.9 0 1 0 20.5 14.2Z"/></svg>';
 var saved='light';
 try{saved=localStorage.getItem(key)||'light'}catch(_){}
 function apply(theme){
  var dark=theme==='dark';
  root.setAttribute('data-theme',dark?'dark':'light');
  var meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.setAttribute('content',dark?'#0d1713':'#f7f8f4');
  var btn=document.querySelector('.theme-toggle');
  if(btn){btn.innerHTML=(dark?sun:moon)+'<span>'+(dark?'الوضع النهاري':'الوضع الليلي')+'</span>';btn.setAttribute('aria-pressed',String(dark));btn.setAttribute('aria-label',dark?'التبديل إلى الوضع النهاري':'التبديل إلى الوضع الليلي');}
  try{localStorage.setItem(key,dark?'dark':'light')}catch(_){}
 }
 function mount(){
  var host=document.querySelector('.nav .wrap')||document.querySelector('body > .wrap > header')||document.querySelector('header');
  if(!host||document.querySelector('.theme-toggle'))return;
  var btn=document.createElement('button');btn.type='button';btn.className='theme-toggle';btn.addEventListener('click',function(){apply(root.getAttribute('data-theme')==='dark'?'light':'dark')});
  var nav=host.querySelector('.desktop-links');
  if(nav)host.insertBefore(btn,nav.nextSibling);
  else host.appendChild(btn);
  apply(root.getAttribute('data-theme')||saved);
 }
 function addMotion(){
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  document.body.classList.add('motion-ready');
  var candidates=document.querySelectorAll('.site section,.site .card,.site .row,.wrap .card,.wrap .next,.wrap .section-heading');
  candidates.forEach(function(el){el.classList.add('motion-reveal')});
  if('IntersectionObserver' in window){
   var io=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add('is-visible');io.unobserve(entry.target)}})},{threshold:.08,rootMargin:'0px 0px -35px 0px'});
   candidates.forEach(function(el){io.observe(el)});
  }else candidates.forEach(function(el){el.classList.add('is-visible')});
  document.querySelectorAll('.site .card,.wrap .card').forEach(function(el){
   el.classList.add('motion-card');
   el.addEventListener('pointermove',function(e){
    if(e.pointerType!=='mouse'||window.innerWidth<900)return;
    var r=el.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;
    el.style.transform='perspective(900px) rotateX('+(-y*2.2)+'deg) rotateY('+(x*2.2)+'deg) translateY(-3px)';
   });
   el.addEventListener('pointerleave',function(){el.style.transform=''});
  });
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){mount();addMotion()},{once:true});
 else{mount();addMotion()}
})();
