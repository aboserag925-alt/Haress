(function(root){'use strict';
const messages={blocked:'تعذر تشغيل هذا المقطع داخل حارس هنا. يمكنك فتحه على يوتيوب.',unavailable:'هذا المقطع غير متاح أو خاص. يمكنك مراجعة مصدره على يوتيوب.',failed:'تعذر تشغيل هذا المقطع داخل حارس. يمكنك فتحه على يوتيوب.',unconfirmed:'لم نتأكد من بدء التشغيل داخل حارس. قد يطلب يوتيوب تحققًا أو تظهر قيود في المشغّل. يمكنك فتحه على يوتيوب.'};
function errorKind(code){return [101,150].includes(code)?'blocked':code===100?'unavailable':'failed';}
let apiPromise;
function loadAPI(){
 if(root.YT?.Player)return Promise.resolve(root.YT);
 if(apiPromise)return apiPromise;
 apiPromise=new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{apiPromise=null;reject(Error('PLAYER_API_UNAVAILABLE'));},12000);
  root.onYouTubeIframeAPIReady=()=>{clearTimeout(timeout);resolve(root.YT);};
  let script=document.querySelector('#youtube-player-api');
  if(script)script.remove();
  script=document.createElement('script');script.id='youtube-player-api';script.src='https://www.youtube.com/iframe_api';
  script.onerror=()=>{clearTimeout(timeout);apiPromise=null;reject(Error('PLAYER_API_UNAVAILABLE'));};
  document.head.append(script);
 });return apiPromise;
}
function createController(host,urls,{timeoutMs=20000}={}){
 let generation=0,instance=null,timer=null;
 return {open:async(v)=>{
  const token=++generation;clearTimeout(timer);try{instance?.destroy();}catch{}instance=null;host.replaceChildren();
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent='جارٍ تجهيز مشغّل يوتيوب داخل حارس…';
  const mount=document.createElement('div'),fallback=document.createElement('a');fallback.href=urls(v.id).watch;fallback.target='_blank';fallback.rel='noopener noreferrer';fallback.textContent='فتح على يوتيوب ↗';
  host.append(mount,status,fallback);host.scrollIntoView({block:'center'});
  const show=(kind)=>{if(token!==generation)return;clearTimeout(timer);status.textContent=messages[kind];status.dataset.state=kind;};
  if(v.embeddable===false){mount.remove();show('blocked');return;}
  try{
   const YT=await loadAPI();if(token!==generation)return;
   instance=new YT.Player(mount,{host:'https://www.youtube-nocookie.com',videoId:v.id,width:'100%',height:'100%',playerVars:{playsinline:1,origin:location.origin},events:{
    onReady:()=>{if(token===generation)status.textContent='اضغط تشغيل داخل المشغّل. إن تعذر العرض يمكنك فتحه على يوتيوب.';},
    onError:e=>show(errorKind(e.data)),
    onStateChange:e=>{if(token!==generation)return;if(e.data===1){clearTimeout(timer);status.textContent='التشغيل داخل حارس';status.dataset.state='playing';}}
   }});
   timer=setTimeout(()=>show('unconfirmed'),timeoutMs);
  }catch{mount.remove();show('failed');}
 }};
}
root.HaressPlayer={createController,errorKind,messages};
})(window);
