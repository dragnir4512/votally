import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config, isTest } from './config.js';

// ============ SMS ============
export interface SmsProvider { send(to: string, message: string): Promise<void>; }

/** Développement : écrit le SMS dans la console. À remplacer par un fournisseur couvrant MTN / Orange / Camtel / Nexttel. */
class ConsoleSms implements SmsProvider {
  async send(to: string, message: string) { if (!isTest) console.log(`[SMS → ${to}] ${message}`); }
}
export const sms: SmsProvider = new ConsoleSms();

// ============ PAIEMENT ============
export type PaymentMethod = 'mtn_momo' | 'orange_money' | 'card';
export type ProviderStatus = 'pending' | 'succeeded' | 'failed' | 'expired';

/** Contrat à implémenter pour chaque agrégateur (CinetPay, Notch Pay, Monetbil, Campay, Flutterwave...). */
export interface PaymentProvider {
  readonly name: string;
  /** Frais de transaction affichés au votant AVANT paiement (FCFA entiers). */
  estimateFee(subtotalXaf: number): number;
  initiate(i: { reference: string; amountXaf: number; method: PaymentMethod; phone?: string }): Promise<{ providerReference: string }>;
  /** Vérification serveur à serveur : on ne se fie JAMAIS au seul contenu du webhook. */
  verify(providerReference: string): Promise<{ status: ProviderStatus; amountXaf?: number }>;
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
  parseWebhook(body: any): { eventId: string; providerReference: string };
}

// --- Agrégateur factice pour développement et tests ---
const mockPayments = new Map<string, { status: ProviderStatus; amountXaf: number }>();

export const mockProvider: PaymentProvider & { sign(raw: string): string; setStatus(ref: string, status: ProviderStatus): void } = {
  name: 'mock',
  estimateFee: (subtotal) => Math.ceil((subtotal * config.FEE_RATE_BPS) / 10_000),
  async initiate({ amountXaf }) {
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

const providers: Record<string, PaymentProvider> = { mock: mockProvider };
export const getPaymentProvider = (name: string) => providers[name];
export const defaultProvider = () => providers[config.PAYMENT_PROVIDER]!;
