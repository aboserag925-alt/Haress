(function(root){'use strict';
const VIDEO=/^[A-Za-z0-9_-]{11}$/;
function normalize(v,channelId){
 if(!v||!VIDEO.test(v.id||'')||v.snippet?.channelId!==channelId)return null;
 const count=v.statistics?.viewCount;
 return {id:v.id,title:typeof v.snippet.title==='string'?v.snippet.title.slice(0,500):'بدون عنوان',publishedAt:v.snippet.publishedAt||null,viewCount:/^\d+$/.test(String(count))?String(count):null,embeddable:typeof v.status?.embeddable==='boolean'?v.status.embeddable:null,privacy:v.status?.privacyStatus||'unknown',broadcast:v.snippet.liveBroadcastContent||'unknown',scheduledAt:v.liveStreamingDetails?.scheduledStartTime||null,actualStart:v.liveStreamingDetails?.actualStartTime||null,actualEnd:v.liveStreamingDetails?.actualEndTime||null};
}
function urls(id){if(!VIDEO.test(id||''))return null;return {watch:'https://www.youtube.com/watch?v='+id,embed:'https://www.youtube-nocookie.com/embed/'+id};}
function liveState(snapshot,now=Date.now(),ttl=180000){
 if(!snapshot||snapshot.error||!Array.isArray(snapshot.items))return {state:'unknown',label:'حالة البث غير متاحة',live:[],upcoming:[]};
 const checked=Date.parse(snapshot.checkedAt),age=now-checked;
 if(!Number.isFinite(age)||age<0||(snapshot.version!==1&&age>ttl))return {state:'stale',label:'حالة البث تحتاج تحديثًا',live:[],upcoming:[]};
 const expires=Date.parse(snapshot.expiresAt);
 if(snapshot.version===1&&(!Number.isFinite(expires)||expires<=checked||now>=expires))return {state:'stale',label:'حالة البث تحتاج تحديثًا',live:[],upcoming:[]};
 const rows=snapshot.items.map(v=>normalize(v,snapshot.channelId)).filter(Boolean);
 const live=rows.filter(v=>v.broadcast==='live'&&!v.actualEnd&&v.privacy==='public');
 const upcoming=rows.filter(v=>v.broadcast==='upcoming'&&!v.actualEnd&&v.privacy==='public');
 if(live.length)return {state:'live',label:'بث مباشر الآن',live,upcoming,checkedAt:snapshot.checkedAt};
 // Empty videos.list for cached IDs never proves the whole channel offline.
 if(!snapshot.discoveryComplete)return {state:'unknown',label:'لا يوجد تأكيد حديث لبث نشط',live:[],upcoming};
 return {state:'not_detected',label:'لم يُرصد بث نشط عند آخر فحص',live:[],upcoming,checkedAt:snapshot.checkedAt};
}
function sortLibrary(rows,order='latest'){
 return rows.slice().sort((a,b)=>{
  if(order==='views'){
   if(a.viewCount==null&&b.viewCount!=null)return 1;if(b.viewCount==null&&a.viewCount!=null)return -1;
   const x=BigInt(a.viewCount||0),y=BigInt(b.viewCount||0);if(x!==y)return x>y?-1:1;
  }
  return (Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0)||a.id.localeCompare(b.id);
 });
}
const api=Object.freeze({normalize,urls,liveState,sortLibrary});if(typeof module==='object'&&module.exports)module.exports=api;else root.HaressVideoLive=api;
})(typeof window!=='undefined'?window:globalThis);
