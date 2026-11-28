import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleRequest, SECURITY_HEADERS } from './index.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../app');
const env={ASSETS:{fetch:async req=>{
  const url=new URL(req.url);
  const filename=url.pathname==='/'?'/index.html':url.pathname;
  try{return new Response(req.method==='HEAD'?null:await fs.readFile(path.join(root,filename)),{headers:{'Content-Type':filename.endsWith('.html')?'text/html':'application/octet-stream'}})}
  catch{return new Response('not found',{status:404})}
}}};
const get=(p,headers={},method='GET')=>handleRequest(new Request('https://site.example'+p,{headers,method}),env);

test('explicit Markdown preference returns only the authored public representation',async()=>{
 const response=await get('/',{Accept:'text/markdown'});
 assert.equal(response.status,200);
 assert.match(response.headers.get('Content-Type'),/^text\/markdown/);
 assert.match(await response.text(),/^# استراحة أهل الأثر/);
 assert.match(response.headers.get('Vary'),/Accept/);
 assert.equal(response.headers.get('Cache-Control'),'public, max-age=60');
 for(const [key,value] of Object.entries(SECURITY_HEADERS))assert.equal(response.headers.get(key),value);
});
test('HTML remains short-lived and versioned static assets receive long immutable caching',async()=>{
 const html=await get('/v3/index.html');
 assert.equal(html.headers.get('Cache-Control'),'public, max-age=60');
 const asset=await get('/v3/identity.css?v=20261128');
 assert.equal(asset.headers.get('Cache-Control'),'public, max-age=31536000, immutable');
 const externalAsset=await get('/auth-client.js?v=20261128');
 assert.equal(externalAsset.headers.get('Cache-Control'),'public, max-age=31536000, immutable');
 const privateHtml=await get('/v3/index.html',{Cookie:'session=private'});
 assert.equal(privateHtml.headers.get('Cache-Control'),'no-store');
});
test('HTML stays default and carries real discovery links',async()=>{
 for(const accept of ['', '*/*','text/markdown;q=0,text/html','text/html;q=1,text/markdown;q=0.5']){
  const response=await get('/',{Accept:accept});
  assert.equal(response.status,307);
  assert.equal(response.headers.get('Location'),'https://site.example/v3/');
  assert.match(response.headers.get('Link'),/api-catalog/);
  assert.match(response.headers.get('Vary'),/Cookie/);
 }
});
test('authenticated, cookie and query requests never get negotiated public Markdown',async()=>{
 for(const [p,headers] of [['/',{Authorization:'Bearer test'}],['/',{Cookie:'session=test'}],['/?code=test',{}],['/?access_token=test',{}]]){
  const response=await get(p,{Accept:'text/markdown',...headers});
  assert.equal(response.status,307);
  assert.match(response.headers.get('Location'),/\/v3\//);
 }
});
test('HEAD has correct representation headers and no body',async()=>{
 const response=await get('/',{Accept:'text/markdown'},'HEAD');
 assert.match(response.headers.get('Content-Type'),/^text\/markdown/);
 assert.equal(await response.text(),'');
});
test('private and unsupported protocol routes remain absent and API failures remain failures',async()=>{
 for(const p of ['/admin.html','/v3/','/.well-known/oauth-authorization-server','/.well-known/mcp/server-card.json','/.well-known/poppy.json','/.well-known/ucp']){
  const response=await get(p,{Accept:'text/markdown'});
  assert.doesNotMatch(response.headers.get('Content-Type')||'',/^text\/markdown/);
 }
 const response=await get('/api/v1',{Accept:'text/markdown'});
 assert.equal(response.status,503);
});
test('catalog describes existing read routes, with honest failure responses and no write operations',async()=>{
 const response=await get('/.well-known/api-catalog');
 assert.match(response.headers.get('Content-Type'),/^application\/linkset\+json/);
 const catalog=await response.json();assert.equal(catalog.linkset.length,1);
 assert.equal(catalog.linkset[0].anchor,'https://hares.aboserag925.workers.dev/api/library');
 const spec=await (await get('/openapi.json')).json();
 assert.deepEqual(Object.keys(spec.paths).sort(),['/api/health','/api/library']);
 for(const value of Object.values(spec.paths)){
  assert.deepEqual(Object.keys(value),['get']);assert.ok(value.get.responses['503']);
 }
});
test('sitemap lists public page URLs only and never account, admin, fragment or API URLs',async()=>{
 const response=await get('/sitemap.xml');assert.match(response.headers.get('Content-Type'),/^application\/xml/);
 const xml=await response.text();const urls=[...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]);
 assert.deepEqual(urls,['https://hares.aboserag925.workers.dev/','https://hares.aboserag925.workers.dev/v3/']);
 assert.doesNotMatch(xml,/admin|account|\/api\/|#/);
});
test('non-GET requests are not converted to successful discovery responses',async()=>{
 const response=await handleRequest(new Request('https://site.example/',{method:'POST',headers:{Accept:'text/markdown'}}),{ASSETS:{fetch:async()=>new Response('method not allowed',{status:405})}});
 assert.equal(response.status,405);
 assert.doesNotMatch(response.headers.get('Content-Type')||'',/^text\/markdown/);
});

test('approved robots policy separates public retrieval from training and advertises sitemap',async()=>{
 const response=await get('/robots.txt');assert.match(response.headers.get('Content-Type'),/^text\/plain/);
 const robots=await response.text();
 assert.match(robots,/Content-Signal: search=yes, ai-input=yes, ai-train=no/);
 assert.match(robots,/User-agent: GPTBot\r?\nUser-agent: ClaudeBot\r?\nDisallow: \//);
 assert.match(robots,/User-agent: OAI-SearchBot\r?\nUser-agent: Claude-SearchBot\r?\nUser-agent: Claude-User\r?\nAllow: \//);
 assert.equal((robots.match(/Disallow: \/api\//g)||[]).length,2);
 assert.equal((robots.match(/Disallow: \/admin\.html/g)||[]).length,2);
 assert.match(robots,/Sitemap: https:\/\/hares\.aboserag925\.workers\.dev\/sitemap\.xml/);
});

 test('provisional identity entry preserves query/hash and leaves private/assets routes untouched', async()=>{
  for(const method of ['GET','HEAD'])for(const entry of ['/','/index.html']){
   const r=await get(entry+'?code=keep#account',{},method);
   assert.equal(r.status,307);assert.equal(r.headers.get('Location'),'https://site.example/v3/?code=keep#account');
   assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(await r.text(),'');
  }
  for(const p of ['/v3/','/admin.html','/v3/identity.css','/runtime-config.js']){
   const r=await get(p);assert.notEqual(r.status,307);
  }
 });
