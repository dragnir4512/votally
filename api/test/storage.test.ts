import { describe, expect, it, vi } from 'vitest';
import { S3Storage } from '../src/storage.js';

const options = {
  endpoint: 'https://objects.example.test',
  region: 'auto',
  bucket: 'votally-private',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key',
};

describe('S3Storage', () => {
  it('signe les requêtes S3 et écrit, lit puis supprime un objet', async () => {
    const payload = Buffer.from('fichier-test');
    const calls: { url: string; method: string; authorization: string | null; body: unknown }[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        authorization: headers.get('authorization'),
        body: init?.body,
      });
      if (init?.method === 'GET') return new Response(payload, { status: 200 });
      return new Response(null, { status: init?.method === 'DELETE' ? 204 : 200 });
    };
    const storage = new S3Storage(options, fakeFetch);
    const key = 'a'.repeat(32) + '.pdf';

    await storage.put(key, payload);
    expect(await storage.get(key)).toEqual(payload);
    await storage.delete(key);

    expect(calls).toHaveLength(3);
    expect(calls.map((call) => call.method)).toEqual(['PUT', 'GET', 'DELETE']);
    expect(calls.every((call) => call.url.endsWith('/votally-private/' + key))).toBe(true);
    expect(calls.every((call) => call.authorization?.startsWith('AWS4-HMAC-SHA256 Credential=test-access-key/'))).toBe(true);
    expect(calls[0]?.body).toBeInstanceOf(Uint8Array);
  });

  it('renvoie null lorsqu’un objet est absent', async () => {
    const fakeFetch: typeof fetch = async () => new Response(null, { status: 404 });
    const storage = new S3Storage(options, fakeFetch);
    expect(await storage.get('b'.repeat(32) + '.webp')).toBeNull();
  });

  it('refuse les clés arbitraires avant tout appel réseau', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const storage = new S3Storage(options, fetchMock);
    await expect(storage.get('../secret.pdf')).rejects.toThrow('Clé de fichier invalide');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuse un endpoint HTTP distant', () => {
    expect(() => new S3Storage({ ...options, endpoint: 'http://objects.example.test' })).toThrow('HTTPS');
  });
});
