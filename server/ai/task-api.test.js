'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createTaskApi}=require('./task-api');
function response(){return{status:null,headers:{},body:'',writeHead(status,headers){this.status=status;Object.assign(this.headers,headers||{});},setHeader(key,value){this.headers[key]=value;},end(value){this.body=value||'';}};}
function request(body,headers={}){const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method='POST';req.headers={'content-type':'application/json',authorization:'Bearer valid.token.value',...headers};return req;}
const env={SUPABASE_URL:'https://preview.example',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'};
function authFetch(url){return url.endsWith('/auth/v1/user')?Promise.resolve({ok:true,json:async()=>({id:'preview-admin'})}):Promise.resolve({ok:true,json:async()=>[{user_id:'preview-admin'}]});}
test('AI task endpoint requires an authenticated Preview administrator',async()=>{
 const api=createTaskApi({env,fetch:async()=>({ok:false}),taskService:{create:async()=>{throw Error('must not create');}},supervisor:{}});
 const res=response();await api(request({type:'suggestion',title:'عنوان صالح',description:'وصف صالح للمهمة'} ,{authorization:'Bearer invalid'}),res,'/api/admin/ai/tasks');
 assert.equal(res.status,403);
});
test('AI task endpoint rejects client-supplied trust and approval fields',async()=>{
 let created=false;
 const api=createTaskApi({env,fetch:authFetch,taskService:{create:async()=>{created=true;}},supervisor:{}});
 const res=response();await api(request({type:'suggestion',title:'عنوان صالح',description:'وصف صالح للمهمة',trustedSource:true}),res,'/api/admin/ai/tasks');
 assert.equal(res.status,400);assert.equal(created,false);
});
test('AI task endpoint persists tainted task reviews after admin-only analysis',async()=>{
 let createArgs,analysisInput,reviewArgs,statusArgs;
 const taskService={
  create:async args=>{createArgs=args;return{id:'task-preview-1',tainted:true,status:'PROPOSED'};},
  recordReviews:async(id,reports)=>{reviewArgs={id,reports};},
  updateStatus:async(id,status)=>{statusArgs={id,status};return{id,status,tainted:true};}
 };
 const supervisor={analyze:async input=>{analysisInput=input;return{task:{id:input.id,status:'ANALYZED',tainted:true},reports:[{agent:'security',status:'PASS',data:{reviewRequired:true},warnings:[]}],plan:[{reviewRequired:true}]};}};
 const api=createTaskApi({env,fetch:authFetch,taskService,supervisor});
 const res=response();await api(request({type:'suggestion',title:'تحسين المكتبة',description:'إضافة تصنيف جديد إلى مكتبة المواد',affectedAreas:['library']}),res,'/api/admin/ai/tasks');
 assert.equal(res.status,201);
 assert.deepEqual(createArgs,{source:'suggestion',affectedAreas:['library']});
 assert.equal(analysisInput.id,'task-preview-1');
 assert.equal(analysisInput.title,'تحسين المكتبة');
 assert.equal(reviewArgs.id,'task-preview-1');
 assert.deepEqual(statusArgs,{id:'task-preview-1',status:'ANALYZED'});
 assert.equal(JSON.parse(res.body).task.tainted,true);
});
test('AI task endpoint persists failed required reviews as FAILED',async()=>{
 let savedStatus;
 const api=createTaskApi({env,fetch:authFetch,taskService:{create:async()=>({id:'task-failed'}),recordReviews:async()=>{},updateStatus:async(id,status)=>{savedStatus=status;return{id,status};}},supervisor:{analyze:async()=>({task:{status:'FAILED'},reports:[{agent:'security',status:'BLOCKED'}]})}});
 const res=response();await api(request({type:'security',title:'مراجعة الصلاحيات',description:'تحقق من إعدادات الصلاحيات الحالية'}),res,'/api/admin/ai/tasks');
 assert.equal(res.status,201);assert.equal(savedStatus,'FAILED');
});
