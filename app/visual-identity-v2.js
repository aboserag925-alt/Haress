/* Haress V2 — cinematic motion, editorial chapters and compact navigation */
(function(){
 'use strict';
 var root=document.documentElement;
 var reduced=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
 var sectionIds=['sched','prayers','qibla','adhkar','media','q','about','account'];
 var tabIds=['t1','t2','t3','t4','t5','t6','t7','t8'];
 function progress(){
  var bar=document.createElement('div');bar.className='reading-progress';bar.setAttribute('aria-hidden','true');document.body.appendChild(bar);
  var queued=false;
  function paint(){var max=document.documentElement.scrollHeight-window.innerHeight;var p=max>0?window.scrollY/max:0;bar.style.transform='scaleX('+Math.max(0,Math.min(1,p))+')';queued=false;}
  window.addEventListener('scroll',function(){if(!queued){queued=true;window.requestAnimationFrame(paint)}},{passive:true});
  paint();
 }
 function reveal(){
  var nodes=document.querySelectorAll('.main-intro,.chapter-heading,.countdown-rail,.section-stage>section,.library-feature,.colophon-copy');
  if(reduced||!('IntersectionObserver' in window)){nodes.forEach(function(n){n.classList.add('is-visible')});return;}
  var io=new IntersectionObserver(function(entries){entries.forEach(function(e){if(e.isIntersecting){e.target.classList.add('is-visible');io.unobserve(e.target)}})},{threshold:.08,rootMargin:'0px 0px -35px 0px'});
  nodes.forEach(function(n){n.classList.add('motion-reveal');io.observe(n)});
  var schedule=document.getElementById('sched');
  if(schedule&&'MutationObserver' in window){
   var mo=new MutationObserver(function(){schedule.querySelectorAll(':scope > .card:not(.motion-reveal)').forEach(function(card,i){card.classList.add('motion-reveal');card.style.transitionDelay=Math.min(i*65,260)+'ms';io.observe(card)})});
   mo.observe(schedule,{childList:true});
  }
 }
 function setNavigation(section){
  var map={sched:'t1',prayers:'t2',qibla:'t3',adhkar:'t4',media:'t5',q:'t6',about:'t7',account:'t8'};
  var active=map[section];
  tabIds.forEach(function(id){var el=document.getElementById(id);if(!el)return;var on=id===active;el.classList.toggle('on',on);el.setAttribute('aria-pressed',on?'true':'false')});
  document.querySelectorAll('.desktop-link').forEach(function(el){el.classList.toggle('is-active',el.getAttribute('data-section')===section)});
  root.setAttribute('data-active-section',section);
  var more=document.querySelector('.mobile-more');if(more&&more.open)more.open=false;
 }
 function navigation(){
  document.addEventListener('click',function(event){
   var button=event.target.closest('button[onclick*="show("]');
   if(!button)return;
   var match=(button.getAttribute('onclick')||'').match(/show\(['"]([^'"]+)['"]\)/);
   if(!match)return;
   var section=match[1],schedule=document.querySelector('.weekly-stage'),intro=document.querySelector('.main-intro'),stage=document.querySelector('.section-stage');
   var isSchedule=section==='sched';
   if(schedule)schedule.hidden=!isSchedule;
   if(intro)intro.hidden=!isSchedule;
   if(stage)stage.hidden=isSchedule;
   setNavigation(section);
  },true);
 }
 function pointerDepth(){
  if(reduced||window.matchMedia('(hover: none)').matches||window.innerWidth<900)return;
  var stage=document.querySelector('.opening-stage'),art=document.querySelector('.opening-art');
  if(!stage||!art)return;
  stage.addEventListener('pointermove',function(e){if(e.pointerType!=='mouse')return;var r=stage.getBoundingClientRect();var x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;art.style.transform='translate3d('+(-x*9)+'px,'+(-y*7)+'px,0)'});
  stage.addEventListener('pointerleave',function(){art.style.transform=''});
  document.querySelectorAll('.opening-enter,.opening-library,.colophon-support').forEach(function(btn){
   btn.addEventListener('pointermove',function(e){if(e.pointerType!=='mouse')return;var r=btn.getBoundingClientRect(),x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2;btn.style.transform='translate3d('+x*.035+'px,'+y*.045+'px,0)'});
   btn.addEventListener('pointerleave',function(){btn.style.transform=''});
  });
 }
 function boot(){
  reveal();progress();navigation();pointerDepth();root.classList.add('haress-motion-ready');
  setNavigation('sched');
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();