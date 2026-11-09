'use strict';

class MemoryStore {
  constructor() { this.objects = new Map(); }
  async put(key, buffer, contentType) {
    if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
    this.objects.set(key, { body: Buffer.from(buffer), contentType: contentType || 'application/octet-stream' });
  }
  async get(key) {
    const e = this.objects.get(key);
    return e ? { body: Buffer.from(e.body), contentType: e.contentType } : null;
  }
  async head(key) {
    const e = this.objects.get(key);
    return e ? { contentType: e.contentType, size: e.body.length } : null;
  }
  async exists(key) { return this.objects.has(key); }
  async listKeys(prefix) {
    return [...this.objects.keys()].filter(k => !prefix || k.startsWith(prefix));
  }
  async delete(key) { this.objects.delete(key); }
}

class R2MediaStorage {
  constructor(config) {
    const cfg = config || {};
    this.bucket = cfg.bucket || process.env.R2_BUCKET;
    this.endpoint = cfg.endpoint || process.env.R2_ENDPOINT;
    this.accessKeyId = cfg.accessKeyId || process.env.R2_ACCESS_KEY_ID;
    this.secretAccessKey = cfg.secretAccessKey || process.env.R2_SECRET_ACCESS_KEY;
    this._client = cfg.client || null;
  }
  _getClient() {
    if (this._client) return this._client;
    const { S3Client } = require('@aws-sdk/client-s3');
    this._client = new S3Client({
      region: 'auto',
      endpoint: this.endpoint,
      credentials: { accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey }
    });
    return this._client;
  }
  async put(key, buffer, contentType) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await this._getClient().send(new PutObjectCommand({
      Bucket: this.bucket, Key: key, Body: buffer, ContentType: contentType || 'application/octet-stream'
    }));
  }
  async get(key) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    try {
      const out = await this._getClient().send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const buf = Buffer.from(await out.Body.transformToByteArray());
      return { body: buf, contentType: out.ContentType || 'application/octet-stream', size: buf.length };
    } catch (e) {
      if (e.name === 'NoSuchKey' || e.name === 'NotFound') return null;
      throw e;
    }
  }
  async head(key) {
    const { HeadObjectCommand } = require('@aws-sdk/client-s3');
    try {
      const out = await this._getClient().send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { contentType: out.ContentType, size: out.ContentLength };
    } catch (e) {
      if (e.name === 'NotFound' || e.name === 'NoSuchKey') return null;
      throw e;
    }
  }
  async exists(key) { const h = await this.head(key); return !!h; }
  async listKeys(prefix) {
    const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
    const res = await this._getClient().send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix || '' }));
    return (res.Contents || []).map(o => o.Key);
  }
  async delete(key) {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await this._getClient().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

function hasR2Config(env) {
  const e = env || process.env;
  return !!(e.R2_BUCKET && e.R2_ACCOUNT_ID && e.R2_ENDPOINT && e.R2_ACCESS_KEY_ID && e.R2_SECRET_ACCESS_KEY);
}

function resolveStorage(env, options) {
  if (options && options.storage) return options.storage;
  if (hasR2Config(env)) return new R2MediaStorage({ bucket: env.R2_BUCKET, endpoint: env.R2_ENDPOINT, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY });
  return null;
}

module.exports = { MemoryStore: MemoryStore, R2MediaStorage: R2MediaStorage, hasR2Config: hasR2Config, resolveStorage: resolveStorage };
