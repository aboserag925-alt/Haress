'use strict';

class MemoryStore {
  constructor() { this.objects = new Map(); this.ops = []; }
  async put(key, buffer, contentType, options) {
    if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
    if (this.objects.has(key) && !(options && options.upsert === true)) throw new Error('OBJECT_EXISTS');
    this.objects.set(key, { body: Buffer.from(buffer), contentType: contentType || 'application/octet-stream' });
    this.ops.push('put:' + key);
  }
  async get(key) {
    const e = this.objects.get(key);
    if (!e) return null;
    this.ops.push('get:' + key);
    return { body: Buffer.from(e.body), contentType: e.contentType, size: e.body.length };
  }
  async head(key) {
    const e = this.objects.get(key);
    if (!e) return null;
    this.ops.push('head:' + key);
    return { contentType: e.contentType, size: e.body.length };
  }
  async exists(key) { return this.objects.has(key); }
  async listKeys(prefix) {
    const out = [...this.objects.keys()].filter(k => !prefix || k.startsWith(prefix));
    this.ops.push('list:' + (prefix || ''));
    return out;
  }
  async delete(key) { const had = this.objects.delete(key); if (had) this.ops.push('delete:' + key); return had; }
}

function buildKey(kind, id, filename) {
  const safe = String(filename || 'file').replace(/\\/g, '/').split('/').pop().replace(/[\u0000-\u001f\u007f]/g, '') || 'file';
  const m = { audio: 'audio', video: 'video', books: 'books', images: 'images', other: 'other' };
  const dir = m[kind] || 'other';
  return `library/${dir}/${id}/${safe}`;
}

function SupabaseMediaStorage(opts) {
  const o = opts || {};
  this.bucket = o.bucket || process.env.SUPABASE_BUCKET || 'haress-media';
  this.supabaseUrl = o.supabaseUrl || process.env.SUPABASE_URL;
  this.serviceRoleKey = o.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

async function sbRequest(path, method, opts, supabaseUrl, serviceKey) {
  const o = opts || {};
  const url = supabaseUrl + '/storage/v1' + path;
  const headers = { 'apikey': serviceKey, 'Authorization': 'Bearer ' + serviceKey, ...(o.headers || {}) };
  const init = { method: method || 'GET', headers: headers };
  if (o.body !== undefined) init.body = o.body;
  if (o.raw) {
    const res = await fetch(url, init);
    return res;
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const e = new Error('Supabase storage ' + res.status + ' ' + res.statusText);
    e.status = res.status; e.body = data; e.code = data && (data.error || data.code || data.message);
    throw e;
  }
  return data;
}

SupabaseMediaStorage.prototype.put = async function (key, buffer, contentType, options) {
  const u = this.supabaseUrl; const k = this.serviceRoleKey;
  await sbRequest('/object/' + this.bucket + '/' + encodeURIComponent(key).replace(/%2F/g, '/'), 'POST', {
    headers: { 'Content-Type': contentType || 'application/octet-stream', 'x-upsert': options && options.upsert === true ? 'true' : 'false' },
    body: buffer
  }, u, k);
};
SupabaseMediaStorage.prototype.get = async function (key) {
  const u = this.supabaseUrl; const k = this.serviceRoleKey;
  try {
    const res = await sbRequest('/object/' + this.bucket + '/' + encodeURIComponent(key).replace(/%2F/g, '/'), 'GET', { raw: true }, u, k);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('Supabase storage ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    return { body: buf, contentType: res.headers.get('content-type') || 'application/octet-stream', size: buf.length };
  } catch (e) { if (e.status === 404) return null; throw e; }
};
SupabaseMediaStorage.prototype.head = async function (key) {
  const g = await this.get(key);
  if (!g) return null;
  return { contentType: g.contentType, size: g.size };
};
SupabaseMediaStorage.prototype.exists = async function (key) { return !!(await this.head(key)); };
SupabaseMediaStorage.prototype.listKeys = async function (prefix) {
  const u = this.supabaseUrl; const k = this.serviceRoleKey;
  // list with prefix split (supabase list is by folder)
  const parts = String(prefix || '').split('/').filter(Boolean);
  const folder = parts.slice(0, -1).join('/');
  const search = parts[parts.length - 1] || '';
  const data = await sbRequest('/object/list/' + this.bucket + '/' + (folder ? encodeURIComponent(folder).replace(/%2F/g, '/') : ''), 'POST', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 100, offset: 0, search: search || '' })
  }, u, k);
  if (!Array.isArray(data)) return [];
  return data.map(e => (folder ? folder + '/' : '') + e.name).filter(n => n !== (prefix || ''));
};
SupabaseMediaStorage.prototype.delete = async function (key) {
  const u = this.supabaseUrl; const k = this.serviceRoleKey;
  await sbRequest('/object/' + this.bucket, 'DELETE', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: [key] })
  }, u, k);
};

function hasSupabaseConfig(env) {
  return !!(env && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

function resolveStorage(env, options) {
  if (options && options.storage) return options.storage;
  if (hasSupabaseConfig(env)) return new SupabaseMediaStorage({ bucket: env.SUPABASE_STORAGE_BUCKET, supabaseUrl: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY });
  return null;
}

module.exports = { MemoryStore: MemoryStore, SupabaseMediaStorage: SupabaseMediaStorage, hasSupabaseConfig: hasSupabaseConfig, resolveStorage: resolveStorage, buildKey: buildKey };
