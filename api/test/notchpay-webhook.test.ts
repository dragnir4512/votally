
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { notchPayProvider } from '../src/providers/notchpay';

describe('Notch Pay — sécurité des webhooks', () => {
  const secret = config.NOTCHPAY_HASH_KEY!;

  const payload = {
    id: 'evt_test_001',
    event: 'payment.complete',
    data: {
      reference: 'VOTALLY-TEST-001',
    },
  };

  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');

  const sign = (body: Buffer) =>
    createHmac('sha256', secret).update(body).digest('hex');

  it('accepte une signature HMAC valide', () => {
    const signature = sign(rawBody);

    expect(
      notchPayProvider.verifyWebhookSignature(rawBody, signature),
    ).toBe(true);
  });

  it('rejette une signature incorrecte', () => {
    expect(
      notchPayProvider.verifyWebhookSignature(rawBody, 'signature-invalide'),
    ).toBe(false);
  });

  it('rejette une signature absente', () => {
    expect(
      notchPayProvider.verifyWebhookSignature(rawBody, undefined),
    ).toBe(false);
  });

  it('rejette un corps modifié après signature', () => {
    const signature = sign(rawBody);
    const modifiedBody = Buffer.from(
      JSON.stringify({ ...payload, event: 'payment.failed' }),
      'utf8',
    );

    expect(
      notchPayProvider.verifyWebhookSignature(modifiedBody, signature),
    ).toBe(false);
  });

  it('extrait correctement l’identifiant et la référence du paiement', () => {
    expect(notchPayProvider.parseWebhook(payload)).toEqual({
      eventId: 'evt_test_001',
      providerReference: 'VOTALLY-TEST-001',
    });
  });

  it('rejette un événement sans identifiant', () => {
    expect(() =>
      notchPayProvider.parseWebhook({
        event: 'payment.complete',
        data: { reference: 'VOTALLY-TEST-001' },
      }),
    ).toThrow('Format de webhook Notch Pay invalide.');
  });

  it('rejette un événement sans référence de transaction', () => {
    expect(() =>
      notchPayProvider.parseWebhook({
        id: 'evt_test_002',
        event: 'payment.complete',
        data: {},
      }),
    ).toThrow('Format de webhook Notch Pay invalide.');
  });
});
