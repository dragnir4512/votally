import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config, isProd, isTest } from './config.js';

// ============ SMS ============
export interface SmsProvider { send(to: string, message: string): Promise<void>; }

/** Développement : écrit le SMS dans la console. À remplacer par un fournisseur couvrant MTN / Orange / Camtel / Nexttel. */
class ConsoleSms implements SmsProvider {
  async send(to: string, message: string) {
    if (isProd) throw new Error('Aucun fournisseur SMS réel n’est configuré : envoi désactivé en production.');
    if (!isTest) console.log(`[SMS → ${to}] ${message}`);
  }
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
