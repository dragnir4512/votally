import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config, isProd, isTest } from './config.js';
import { notchPayProvider } from './providers/notchpay.js';
import { HttpError } from './http.js';

// ============ SMS ============
export interface SmsProvider { send(to: string, message: string): Promise<void>; }

/** SMSPro : API REST. Un HTTP 2xx signifie accepté par la passerelle, pas livré au téléphone. */
class SmsProProvider implements SmsProvider {
  async send(to: string, message: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(`${config.SMSPRO_API_BASE_URL.replace(/\/$/, '')}/api/v1/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.SMSPRO_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ to, message, from: config.SMSPRO_SENDER_ID }),
        signal: controller.signal,
      });
      if (!response.ok) {
        console.error('[SMSPRO] delivery request rejected', response.status);
        throw new HttpError(503, response.status === 402 ? 'Solde SMS insuffisant chez le fournisseur' : 'Impossible d’envoyer le SMS pour le moment', response.status === 402 ? 'sms_balance_insufficient' : 'sms_delivery_failed');
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      console.error('[SMSPRO] network request failed', error instanceof Error ? error.name : 'unknown');
      throw new HttpError(503, 'Service SMS temporairement indisponible', 'sms_provider_unavailable');
    } finally { clearTimeout(timeout); }
  }
}

/** Développement : simulation sans divulguer le code dans les journaux de test. */
class ConsoleSms implements SmsProvider {
  async send(to: string, message: string) {
    if (isProd) throw new Error('Aucun fournisseur SMS réel n’est configuré : envoi désactivé en production.');
    if (!isTest) console.log(`[SMS → ${to}] ${message}`);
  }
}
export const sms: SmsProvider = config.SMS_PROVIDER === 'smspro' ? new SmsProProvider() : new ConsoleSms();


export interface EmailMessage { to: string; subject: string; text: string; }
export const email = {
  async send(message: EmailMessage): Promise<void> {
    // Aucun appel réseau vers Resend pendant les tests.
    if (isTest) return;

    if (!config.RESEND_API_KEY || !config.EMAIL_FROM) {
      if (isProd) throw new HttpError(503, 'Envoi des emails indisponible pour le moment', 'email_unavailable');
      if (!isTest) console.log(`[EMAIL → ${message.to}] ${message.subject}\n${message.text}`);
      return;
    }
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('[EMAIL] Resend error', response.status, detail.slice(0, 500));
      throw new HttpError(503, 'Impossible d’envoyer l’email pour le moment', 'email_delivery_failed');
    }
  },
};

// ============ PAIEMENT ============
export type PaymentMethod = 'mtn_momo' | 'orange_money' | 'card';
export type ProviderStatus = 'pending' | 'succeeded' | 'failed' | 'expired';

/** Contrat à implémenter pour chaque agrégateur (CinetPay, Notch Pay, Monetbil, Campay, Flutterwave...). */
export interface PaymentProvider {
  readonly name: string;
  /** Frais de transaction affichés au votant AVANT paiement (FCFA entiers). */
  estimateFee(subtotalXaf: number): number;
    initiate(i: {
    reference: string;
    amountXaf: number;
    method: PaymentMethod;
    phone?: string;
    email?: string;
  }): Promise<{
    providerReference: string;
    authorizationUrl?: string;
  }>;
  /** Vérification serveur à serveur : on ne se fie JAMAIS au seul contenu du webhook. */
  verify(providerReference: string): Promise<{ status: ProviderStatus; amountXaf?: number }>;
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
  parseWebhook(body: any): { eventId: string; providerReference: string };

  // ---- Retraits des créateurs (décaissement vers Mobile Money) ----
  /** Frais de retrait retenus sur le montant demandé (FCFA entiers). */
  estimatePayoutFee(amountXaf: number): number;
  /**
   * Envoie l'argent. `reference` (identifiant du retrait chez nous) sert de clé d'idempotence côté agrégateur :
   * rappeler disburse avec la même référence NE DOIT PAS payer deux fois.
   */
  disburse(i: { reference: string; amountXaf: number; method: 'mtn_momo' | 'orange_money'; phone: string; name: string }):
    Promise<{ providerReference: string; status: 'succeeded' | 'processing' | 'failed'; reason?: string }>;
  /** Retrouve un retrait par NOTRE référence ('unknown' si l'agrégateur ne le connaît pas). */
  verifyPayout(reference: string): Promise<{ status: 'succeeded' | 'processing' | 'failed' | 'unknown'; providerReference?: string; reason?: string }>;
}

// --- Agrégateur factice pour développement et tests ---
const mockPayments = new Map<string, { status: ProviderStatus; amountXaf: number }>();

type PayoutOutcome = 'succeeded' | 'processing' | 'failed';
const mockPayouts = new Map<string, { status: PayoutOutcome; providerReference: string; reason?: string }>();

export const mockProvider: PaymentProvider & {
  sign(raw: string): string; setStatus(ref: string, status: ProviderStatus): void;
  /** Résultat des prochains retraits simulés (tests et développement). */
  nextPayoutOutcome: PayoutOutcome; setPayoutStatus(reference: string, status: PayoutOutcome): void;
} = {
  nextPayoutOutcome: 'succeeded',
  estimatePayoutFee: (amount) => Math.max(100, Math.ceil(amount / 100)),         // 1 %, minimum 100 FCFA
  async disburse({ reference }) {
    const known = mockPayouts.get(reference);                                      // idempotence : même référence = même résultat
    if (known) return known;
    const r = { status: mockProvider.nextPayoutOutcome, providerReference: 'MOCKPO-' + randomUUID(),
      reason: mockProvider.nextPayoutOutcome === 'failed' ? 'Compte destinataire refusé (simulation)' : undefined };
    mockPayouts.set(reference, r);
    return r;
  },
  async verifyPayout(reference) { return mockPayouts.get(reference) ?? { status: 'unknown' as const }; },
  setPayoutStatus(reference, status) { const p = mockPayouts.get(reference); if (p) p.status = status; },
  name: 'mock',
  estimateFee: (subtotal) => Math.ceil((subtotal * config.FEE_RATE_BPS) / 10_000),
  async initiate({ amountXaf, email }) {
    const providerReference = 'MOCK-' + randomUUID();
    mockPayments.set(providerReference, { status: 'pending', amountXaf });
    return { providerReference };
  },
  async verify(ref) {
    const p = mockPayments.get(ref);
    return p ? { status: p.status, amountXaf: p.amountXaf } : { status: 'failed' };
  },
  sign: (raw) => createHmac('sha256', config.MOCK_WEBHOOK_SECRET).update(raw).digest('hex'),
  setStatus(ref, status) { const p = mockPayments.get(ref); if (p) p.status = status; },
  verifyWebhookSignature(rawBody, signature) {
    if (!signature) return false;
    const expected = createHmac('sha256', config.MOCK_WEBHOOK_SECRET).update(rawBody).digest('hex');
    const a = Buffer.from(expected), b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  },
  parseWebhook: (body) => ({ eventId: String(body.eventId), providerReference: String(body.providerReference) }),
};

const providers: Record<string, PaymentProvider> = {
  mock: mockProvider,
  notchpay: notchPayProvider,
};

export const getPaymentProvider = (name: string) => providers[name];

/** Fournisseur utilisé pour les paiements des votes. */
export const defaultPaymentProvider = () => providers[config.PAYMENT_PROVIDER]!;

/** Fournisseur utilisé pour les retraits des créateurs. */
/** Aucun agrégateur de décaissement réel n'est intégré pour le moment.
 * En production, on échoue volontairement : le simulateur ne doit jamais
 * transformer un retrait en paiement comptabilisé.
 */
export const defaultPayoutProvider = () => {
  if (isProd) {
    throw new HttpError(503, 'Les retraits sont temporairement indisponibles : aucun fournisseur de décaissement réel n’est configuré.', 'payout_provider_unavailable');
  }
  return mockProvider;
};