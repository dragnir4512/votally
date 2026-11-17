import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config, isProd } from './config.js';

export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

const KEY = /^[a-f0-9]{32}\.(webp|jpg|png|pdf)$/;
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value).digest();
const awsEncode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const amzDate = (date: Date) => date.toISOString().replace(/[:-]|\.\d{3}/g, '');

export class LocalStorage implements Storage {
  constructor(private root: string) {}
  private file(key: string) {
    if (!KEY.test(key)) throw new Error('Clé de fichier invalide');
    return path.join(this.root, key);
  }
  async put(key: string, data: Buffer) {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.file(key), data, { flag: 'wx' });
  }
  async get(key: string) {
    try { return await readFile(this.file(key)); }
    catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
  }
  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
}

export interface S3StorageOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export class S3Storage implements Storage {
  private endpoint: URL;
  constructor(private options: S3StorageOptions, private request: typeof fetch = fetch) {
    this.endpoint = new URL(options.endpoint);
    if (this.endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(this.endpoint.hostname)) {
      throw new Error('Le endpoint S3 doit utiliser HTTPS (sauf en local).');
    }
    if (this.endpoint.search || this.endpoint.hash || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(options.bucket)) {
      throw new Error('Configuration S3 invalide (bucket ou endpoint).');
    }
  }

  private async send(method: 'GET' | 'PUT' | 'DELETE', key: string, data?: Buffer): Promise<Response> {
    if (!KEY.test(key)) throw new Error('Clé de fichier invalide');
    const url = new URL(this.endpoint);
    const prefix = url.pathname.replace(/\/$/, '');
    url.pathname = \`${prefix}/${awsEncode(this.options.bucket)}/${awsEncode(key)}\`;
    const date = amzDate(new Date());
    const payloadHash = sha256(data ?? '');
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': date,
    };
    if (this.options.sessionToken) headers['x-amz-security-token'] = this.options.sessionToken;
    const signedHeaders = Object.keys(headers).sort().join(';');
    const canonicalHeaders = Object.keys(headers).sort().map((name) => \`${name}:${headers[name]!.trim()}\n\`).join('');
    const canonicalRequest = [method, url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = \`${date.slice(0, 8)}/${this.options.region}/s3/aws4_request\`;
    const stringToSign = ['AWS4-HMAC-SHA256', date, scope, sha256(canonicalRequest)].join('\n');
    const dateKey = hmac('AWS4' + this.options.secretAccessKey, date.slice(0, 8));
    const regionKey = hmac(dateKey, this.options.region);
    const serviceKey = hmac(regionKey, 's3');
    const signingKey = hmac(serviceKey, 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    headers.authorization = \`AWS4-HMAC-SHA256 Credential=${this.options.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}\`;
    if (data) headers['content-length'] = String(data.length);
    return this.request(url, { method, headers, ...(data ? { body: new Uint8Array(data) } : {}) });
  }

  async put(key: string, data: Buffer) {
    const response = await this.send('PUT', key, data);
    if (!response.ok) throw new Error(\`Échec du stockage S3 (HTTP ${response.status}).\`);
  }

  async get(key: string): Promise<Buffer | null> {
    const response = await this.send('GET', key);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(\`Échec de lecture S3 (HTTP ${response.status}).\`);
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(key: string) {
    const response = await this.send('DELETE', key);
    if (!response.ok && response.status !== 404) throw new Error(\`Échec de suppression S3 (HTTP ${response.status}).\`);
  }
}

const localStorage = () => new LocalStorage(path.resolve(config.UPLOAD_DIR));
const s3Storage = () => new S3Storage({
  endpoint: config.S3_ENDPOINT!,
  region: config.S3_REGION!,
  bucket: config.S3_BUCKET!,
  accessKeyId: config.S3_ACCESS_KEY_ID!,
  secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
  ...(config.S3_SESSION_TOKEN ? { sessionToken: config.S3_SESSION_TOKEN } : {}),
});

if (isProd && config.STORAGE_DRIVER !== 's3') {
  throw new Error('STORAGE_DRIVER=s3 est obligatoire en production.');
}
export const storage: Storage = config.STORAGE_DRIVER === 's3' ? s3Storage() : localStorage();
export const isValidKey = (key: string) => KEY.test(key);
