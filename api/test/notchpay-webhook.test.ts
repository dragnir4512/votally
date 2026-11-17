
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
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


describe('Notch Pay — vérification serveur du paiement', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lit le statut et le montant dans response.payment', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'success',
      payment: {
        reference: 'trx-votally-001',
        status: 'complete',
        amount: 1025,
        currency: 'XAF',
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(notchPayProvider.verify('trx-votally-001')).resolves.toEqual({
      status: 'succeeded',
      amountXaf: 1025,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/payments/trx-votally-001');
  });

  it('refuse une référence différente de celle vérifiée', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'success',
      payment: {
        reference: 'trx-other',
        status: 'complete',
        amount: 1025,
        currency: 'XAF',
      },
    }), { status: 200 })));

    await expect(notchPayProvider.verify('trx-votally-001'))
      .rejects.toThrow('référence de transaction incohérente');
  });
});
