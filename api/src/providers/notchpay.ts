import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import type { PaymentProvider, ProviderStatus } from '../providers.js';

const API_BASE_URL = 'https://api.notchpay.co';
type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Accepte les enveloppes documentées : { transaction }, { payment } ou { data: ... }. */
function getTransaction(response: unknown): JsonObject | null {
  if (!isObject(response)) return null;
  if (isObject(response.transaction)) return response.transaction;
  if (isObject(response.payment)) return response.payment;
  if (isObject(response.data)) {
    const data = response.data;
    if (isObject(data.transaction)) return data.transaction;
    if (isObject(data.payment)) return data.payment;
    return data;
  }
  return response;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

async function readJson(response: Response): Promise<JsonObject> {
  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const excerpt = raw.replace(/[\r\n\t]+/g, ' ').slice(0, 180);
    throw new Error(`Notch Pay : réponse non JSON (HTTP ${response.status})${excerpt ? ` — ${excerpt}` : ''}`);
  }
  if (!isObject(parsed)) {
    throw new Error(`Notch Pay : format de réponse inattendu (HTTP ${response.status}).`);
  }
  return parsed;
}

function providerError(data: JsonObject, status: number): string {
  const message = getString(data.message) ?? getString(data.error) ?? 'Erreur retournée par le prestataire';
  return `Notch Pay : HTTP ${status} — ${message.slice(0, 240)}`;
}

function extractAuthorizationUrl(data: JsonObject): string | undefined {
  const direct = getString(data.authorization_url);
  if (direct) return direct;
  if (isObject(data.data)) return getString(data.data.authorization_url);
  return undefined;
}

function extractAmount(value: unknown): number | undefined {
  const amount = typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isSafeInteger(amount) && amount >= 1 ? amount : undefined;
}

const statusMap: Record<string, ProviderStatus> = {
  pending: 'pending',
  processing: 'pending',
  accepted: 'pending',
  complete: 'succeeded',
  completed: 'succeeded',
  success: 'succeeded',
  succeeded: 'succeeded',
  failed: 'failed',
  canceled: 'failed',
  cancelled: 'failed',
  expired: 'expired',
};

export const notchPayProvider: PaymentProvider = {
  name: 'notchpay',

  estimateFee(subtotalXaf: number): number {
    return Math.ceil((subtotalXaf * config.FEE_RATE_BPS) / 10_000);
  },

  async initiate({ reference, amountXaf, email, phone, method }) {
    if (!email?.trim()) throw new Error('Une adresse e-mail est obligatoire pour Notch Pay.');
    if (!Number.isSafeInteger(amountXaf) || amountXaf < 1) throw new Error('Montant invalide pour Notch Pay.');

    const callbackUrl = new URL(config.NOTCHPAY_CALLBACK_URL!);
    callbackUrl.searchParams.set('order', reference);

    const payload = {
      amount: amountXaf,
      currency: 'XAF',
      customer: { email: email.trim(), ...(phone ? { phone } : {}) },
      reference,
      locked_currency: 'XAF',
      locked_country: 'CM',
      locked_channel: method === 'mtn_momo' ? 'cm.mtn' : 'cm.orange',
      callback: callbackUrl.toString(),
      description: `Paiement des votes VOTALLY - ${reference}`,
    };

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/payments`, {
        method: 'POST',
        headers: {
          Authorization: config.NOTCHPAY_PUBLIC_KEY!,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === 'TimeoutError'
        ? 'délai de réponse dépassé'
        : 'connexion impossible';
      throw new Error(`Notch Pay : ${reason} lors de la création du paiement.`);
    }

    const data = await readJson(response);
    if (!response.ok) throw new Error(providerError(data, response.status));

    const authorizationUrl = extractAuthorizationUrl(data);
    if (!authorizationUrl) {
      throw new Error('Notch Pay : URL de paiement absente de la réponse.');
    }

    let parsedUrl: URL;
    try { parsedUrl = new URL(authorizationUrl); }
    catch { throw new Error('Notch Pay : URL de paiement invalide.'); }
    if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'pay.notchpay.co') {
      throw new Error('Notch Pay : domaine de paiement inattendu, redirection refusée.');
    }

    // Notch Pay renvoie sa référence de transaction dans transaction.reference.
    // C'est cette valeur que Verify et les webhooks utilisent ; la référence VOTALLY
    // reste dans callback?order=... pour retrouver la commande locale.
    const transaction = getTransaction(data);
    const providerReference = transaction ? getString(transaction.reference) : undefined;
    if (!providerReference) {
      throw new Error('Notch Pay : référence de transaction absente de la réponse d’initialisation.');
    }

    return { providerReference, authorizationUrl };
  },

  async verify(providerReference: string): Promise<{ status: ProviderStatus; amountXaf?: number }> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/payments/${encodeURIComponent(providerReference)}`, {
        method: 'GET',
        headers: { Authorization: config.NOTCHPAY_PUBLIC_KEY!, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === 'TimeoutError'
        ? 'délai de réponse dépassé'
        : 'connexion impossible';
      throw new Error(`Notch Pay : ${reason} pendant la vérification du paiement.`);
    }

    const data = await readJson(response);
    if (!response.ok) throw new Error(providerError(data, response.status));

    const transaction = getTransaction(data);
    if (!transaction) throw new Error('Notch Pay : transaction absente de la réponse de vérification.');

    const returnedReference = getString(transaction.reference);
    if (returnedReference && returnedReference !== providerReference) {
      throw new Error('Notch Pay : référence de transaction incohérente.');
    }

    const currency = getString(transaction.currency)?.toUpperCase();
    if (currency !== 'XAF') throw new Error('Notch Pay : devise de transaction incorrecte.');

    const amountXaf = extractAmount(transaction.amount);
    if (amountXaf === undefined) throw new Error('Notch Pay : montant de transaction invalide.');

    const rawStatus = getString(transaction.status)?.toLowerCase();
    const status = rawStatus ? statusMap[rawStatus] : undefined;
    if (!status) throw new Error(`Notch Pay : statut inconnu (${rawStatus ?? 'absent'}).`);

    return { status, amountXaf };
  },

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature || !config.NOTCHPAY_HASH_KEY) return false;
    const expected = createHmac('sha256', config.NOTCHPAY_HASH_KEY).update(rawBody).digest('hex');
    const actual = Buffer.from(signature.trim(), 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
  },

  parseWebhook(body: any) {
    const eventId = getString(body?.id);
    const providerReference = getString(body?.data?.reference)
      ?? getString(body?.data?.transaction?.reference)
      ?? getString(body?.transaction?.reference);
    if (!eventId || !getString(body?.event ?? body?.type) || !providerReference) {
      throw new Error('Format de webhook Notch Pay invalide.');
    }
    return { eventId, providerReference };
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
