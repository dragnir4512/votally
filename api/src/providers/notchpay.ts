import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import type {
  PaymentMethod,
  PaymentProvider,
  ProviderStatus,
} from '../providers.js';

const API_BASE_URL = 'https://api.notchpay.co';

type NotchPayPaymentResponse = {
  code?: number;
  status?: string;
  message?: string;
  transaction?: {
    reference?: string;
    status?: string;
    amount?: number;
    currency?: string;
  };
  authorization_url?: string;
};

export const notchPayProvider: PaymentProvider = {
  name: 'notchpay',

  estimateFee(subtotalXaf: number): number {
    return Math.ceil((subtotalXaf * config.FEE_RATE_BPS) / 10_000);
  },

 
async initiate({ reference, amountXaf, email, phone }) {
  if (!email) {
    throw new Error('Une adresse e-mail est obligatoire pour Notch Pay.');
  }

  const callbackUrl = new URL(config.NOTCHPAY_CALLBACK_URL!);
  callbackUrl.searchParams.set('order', reference);

    const response = await fetch(`${API_BASE_URL}/payments`, {
      method: 'POST',
      headers: {
        Authorization: config.NOTCHPAY_PUBLIC_KEY!,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        amount: amountXaf,
        currency: 'XAF',
        email,
        phone,
        reference,
        callback: callbackUrl.toString(),
        description: `Paiement des votes VOTALLY - ${reference}`,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await response.json() as NotchPayPaymentResponse;

    if (!response.ok || !data.authorization_url || !data.transaction?.reference) {
      throw new Error(
        `Notch Pay : initialisation impossible (${response.status}) - ${data.message ?? 'Réponse invalide'}`,
      );
    }

    return {
      providerReference: data.transaction.reference,
      authorizationUrl: data.authorization_url,
    };
  },

  async verify(providerReference: string): Promise<{ status: ProviderStatus; amountXaf?: number }> {
  const response = await fetch(
    `${API_BASE_URL}/payments/${encodeURIComponent(providerReference)}`,
    {
      method: 'GET',
      headers: {
        Authorization: config.NOTCHPAY_PUBLIC_KEY!,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    },
  );

  const data = await response.json() as {
    message?: string;
    transaction?: {
      reference?: string;
      amount?: number;
      currency?: string;
      status?: string;
    };
  };

  if (!response.ok || !data.transaction) {
    throw new Error(
      `Notch Pay : vérification impossible (${response.status}) - ${data.message ?? 'Réponse invalide'}`,
    );
  }

  const transaction = data.transaction;

  if (transaction.reference !== providerReference) {
    throw new Error('Notch Pay : référence de transaction incohérente.');
  }

  if (transaction.currency !== 'XAF') {
    throw new Error('Notch Pay : devise de transaction incorrecte.');
  }

  if (!Number.isSafeInteger(transaction.amount) || transaction.amount! < 1) {
    throw new Error('Notch Pay : montant de transaction invalide.');
  }

  const statusMap: Record<string, ProviderStatus> = {
    pending: 'pending',
    processing: 'pending',
    complete: 'succeeded',
    failed: 'failed',
    canceled: 'failed',
    expired: 'expired',
  };

  const status = statusMap[transaction.status ?? ''];

  if (!status) {
    throw new Error(`Notch Pay : statut inconnu (${transaction.status}).`);
  }

  return {
    status,
    amountXaf: transaction.amount,
  };
},

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature || !config.NOTCHPAY_HASH_KEY) return false;

    const expected = createHmac('sha256', config.NOTCHPAY_HASH_KEY)
      .update(rawBody)
      .digest('hex');

    const actual = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');

    return actual.length === expectedBuffer.length
      && timingSafeEqual(actual, expectedBuffer);
  },

  parseWebhook(body: any) {
    if (
      typeof body?.id !== 'string'
      || typeof body?.event !== 'string'
      || typeof body?.data?.reference !== 'string'
    ) {
      throw new Error('Format de webhook Notch Pay invalide.');
    }

    return {
      eventId: body.id,
      providerReference: body.data.reference,
    };
  },

  estimatePayoutFee(amountXaf: number): number {
    return Math.max(100, Math.ceil(amountXaf / 100));
  },

  async disburse() {
    throw new Error('Les retraits Notch Pay ne sont pas activés dans VOTALLY.');
  },

  async verifyPayout() {
    return { status: 'unknown' };
  },
};