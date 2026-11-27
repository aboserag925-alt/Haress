(function(root){
  'use strict';
  // Local catalogue policy, not proof of target ownership, content or access.
  // Telegram message/topic forms: https://core.telegram.org/api/links
  var RESERVED='addemoji addlist addstickers addstyle addtheme auction auth boost call confirmphone contact giftcode invoice joinchat login m nft proxy setlanguage share socks web a k z msg resolve privatepost'.split(' ');
  function parse(value){
    if(typeof value!=='string'||value.length>2048||!value.length||/[\s\u0000-\u001f\u007f\\]/.test(value)||/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value))return null;
    var u;try{u=new URL(value)}catch(e){return null}
    if(!/^https:\/\/[A-Za-z0-9.-]+(?=\/|$)/.test(value))return null;
    if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)return null;
    var h=u.hostname.toLowerCase(),p=u.pathname;
    function params(allowed){var seen={};for(var entry of u.searchParams){if(seen[entry[0]]||!allowed[entry[0]]||!allowed[entry[0]].test(entry[1]))return false;seen[entry[0]]=true}return true}
    if(['youtube.com','www.youtube.com','m.youtube.com','youtu.be','youtube-nocookie.com','www.youtube-nocookie.com'].includes(h)){
      if(!params({v:/^[A-Za-z0-9_-]{11}$/,list:/^[A-Za-z0-9_-]{10,100}$/,t:/^\d{1,8}$/}))return null;
      var yt=(typeof module==='object'&&module.exports?require('./youtube'):root.HaressYouTube).parse(value);
      return yt?{url:u.href,platform:'يوتيوب',access:'يُفتح الأصل على يوتيوب. قد تتطلب بعض المواد تسجيل الدخول أو تخضع لقيود المصدر.'}:null;
    }
    if(['t.me','www.t.me'].includes(h)){
      var parts=p.replace(/\/$/,'').split('/').slice(1),valid=false,num=/^[1-9]\d{0,19}$/;
      if(parts[0]==='c')valid=(parts.length===3||parts.length===4)&&parts.slice(1).every(function(x){return num.test(x)});
      else valid=(parts.length===2||parts.length===3)&&/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(parts[0])&&!RESERVED.includes(parts[0].toLowerCase())&&parts.slice(1).every(function(x){return num.test(x)});
      if(!valid||!params({single:/^$/,thread:num,comment:num,t:/^\d{1,8}$/}))return null;
      // Numeric seconds only; other documented timestamp syntaxes deliberately unsupported.
      return {url:u.href,platform:'تيليجرام',access:'يُفتح الأصل في تيليجرام. قد يلزم تسجيل الدخول وعضوية المجموعة أو القناة؛ الرابط لا يمنح صلاحية الوصول.'};
    }
    if(['www.tiktok.com','tiktok.com'].includes(h)&&/^\/@[A-Za-z0-9_.]+\/video\/\d+\/?$/.test(p)&&!u.search){
      return {url:u.href,platform:'تيك توك',access:'يُفتح الأصل على تيك توك. قد يتطلب تسجيل الدخول أو التطبيق بحسب قيود المصدر.'};
    }
    return null;
  }
  var api=Object.freeze({parse:parse});if(typeof module==='object'&&module.exports)module.exports=api;else root.HaressSourceLinks=api;
})(typeof window!=='undefined'?window:globalThis);
