
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import type {
  PaymentProvider,
  ProviderStatus,
} from '../providers.js';

const API_BASE_URL = 'https://api.notchpay.co';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getTransaction(data: unknown): JsonObject | null {
  if (!isObject(data)) return null;

  const payload = isObject(data.data) ? data.data : data;

  if (isObject(payload.transaction)) {
    return payload.transaction;
  }

  return payload;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0
    ? value
    : undefined;
}

async function readJson(response: Response): Promise<JsonObject> {
  const text = await response.text();

  try {
    const data: unknown = JSON.parse(text);

    if (!isObject(data)) {
      throw new Error('Réponse JSON inattendue.');
    }

    return data;
  } catch {
    throw new Error(
      `Notch Pay : réponse JSON invalide (${response.status}).`,
    );
  }
}

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
        customer: {
          email,
          ...(phone ? { phone } : {}),
        },
        reference,
        callback: callbackUrl.toString(),
        description: `Paiement des votes VOTALLY - ${reference}`,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await readJson(response);
    const transaction = getTransaction(data);

    const authorizationUrl =
      getString(data.authorization_url)
      ?? (isObject(data.data)
        ? getString(data.data.authorization_url)
        : undefined);

    const providerReference = transaction
      ? getString(transaction.reference) ?? getString(transaction.id)
      : undefined;

    if (!response.ok || !authorizationUrl || !providerReference) {
      throw new Error(
        `Notch Pay : initialisation impossible (${response.status}) - ${
          getString(data.message) ?? 'Réponse invalide'
        }`,
      );
    }

    return {
      providerReference,
      authorizationUrl,
    };
  },

  async verify(
    providerReference: string,
  ): Promise<{ status: ProviderStatus; amountXaf?: number }> {
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

    const data = await readJson(response);
    const transaction = getTransaction(data);

    if (!response.ok || !transaction) {
      throw new Error(
        `Notch Pay : vérification impossible (${response.status}) - ${
          getString(data.message) ?? 'Réponse invalide'
        }`,
      );
    }

    const returnedReference =
      getString(transaction.reference) ?? getString(transaction.id);

    if (returnedReference !== providerReference) {
      throw new Error('Notch Pay : référence de transaction incohérente.');
    }

    if (transaction.currency !== 'XAF') {
      throw new Error('Notch Pay : devise de transaction incorrecte.');
    }

    const amount = Number(transaction.amount);

    if (!Number.isSafeInteger(amount) || amount < 1) {
      throw new Error('Notch Pay : montant de transaction invalide.');
    }

    const rawStatus = getString(transaction.status);

    const statusMap: Record<string, ProviderStatus> = {
      pending: 'pending',
      processing: 'pending',
      complete: 'succeeded',
      failed: 'failed',
      canceled: 'failed',
      expired: 'expired',
    };

    const status = rawStatus ? statusMap[rawStatus.toLowerCase()] : undefined;

    if (!status) {
      throw new Error(`Notch Pay : statut inconnu (${rawStatus ?? 'absent'}).`);
    }

    return {
      status,
      amountXaf: amount,
    };
  },

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature || !config.NOTCHPAY_HASH_KEY) return false;

    const expected = createHmac('sha256', config.NOTCHPAY_HASH_KEY)
      .update(rawBody)
      .digest('hex');

    const actualBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');

    return actualBuffer.length === expectedBuffer.length
      && timingSafeEqual(actualBuffer, expectedBuffer);
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
