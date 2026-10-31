// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminPanel from '../components/admin/AdminPanel';
import KycForm from '../components/creator/KycForm';
import PayoutPanel from '../components/creator/PayoutPanel';
import { mediaUrl } from '../lib/format';
import { MeContext } from '../lib/session';
import { MAX_FILE, uploadFile } from '../lib/upload';
import type { Me } from '../lib/creator';

type Call = { key: string; body: unknown; contentType?: string };
let routes: Record<string, (body: any) => { status?: number; json?: unknown }>; let calls: Call[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url.replace(/^\/api/, '')}`;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({ key, body, contentType: headers['content-type'] });
    const h = routes[key];
    if (!h) return new Response(JSON.stringify({ error: { code: 'nf', message: `route non simulée : ${key}` } }), { status: 404 });
    const r = h(body);
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const me = (role: 'creator' | 'admin'): Me => ({ id: 'u1', email: 'a@b.cm', phone: null, fullName: 'Test', role, kycStatus: 'none' });
const file = (name: string, type: string, size = 100) => new File([new Uint8Array(size)], name, { type });

describe('uploadFile / mediaUrl', () => {
  it('refuse sans appel réseau un fichier trop gros ou d\'un mauvais type', async () => {
    routes = {};
    await expect(uploadFile('/x', file('a.png', 'image/png', MAX_FILE + 1))).rejects.toMatchObject({ code: 'too_large' });
    await expect(uploadFile('/x', file('a.txt', 'text/plain'))).rejects.toMatchObject({ code: 'bad_type' });
    await expect(uploadFile('/x', file('a.pdf', 'application/pdf'), 'image')).rejects.toMatchObject({ code: 'bad_type' });   // PDF refusé pour une photo
    expect(calls).toHaveLength(0);
  });
  it('envoie le fichier brut avec son type', async () => {
    routes = { 'POST /x': () => ({ json: { key: 'k' } }) };
    await uploadFile('/x', file('a.pdf', 'application/pdf'), 'document');
    expect(calls[0]).toMatchObject({ key: 'POST /x', contentType: 'application/pdf' });
  });
  it('les images passent par le proxy du site par défaut', () => { expect(mediaUrl('abc.webp')).toBe('/api/media/abc.webp'); expect(mediaUrl(null)).toBeNull(); });
});

describe('KycForm', () => {
  it('envoie la pièce puis le dossier, avec les clés renvoyées par le serveur', async () => {
    let submitted = 0;
    routes = {
      'POST /me/kyc/documents?kind=id': () => ({ status: 201, json: { key: 'idkey.png' } }),
      'POST /me/kyc': () => ({ status: 201, json: { kyc: { id: 'k1' } } }),
    };
    const { container } = render(<KycForm onSubmitted={() => { submitted++; }} />);
    const send = screen.getByRole('button', { name: 'Envoyer mon dossier' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);                                                   // pièce manquante
    const inputs = container.querySelectorAll('input');
    fireEvent.change(inputs[2]!, { target: { value: 'Mikey Test' } });                  // nom légal
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file('cni.png', 'image/png')] } });
    fireEvent.change(container.querySelector('input[type=tel]')!, { target: { value: '677000000' } });
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.submit(container.querySelector('form')!);          // jsdom ne valide pas les champs fichier : on déclenche l'envoi du formulaire directement
    await waitFor(() => expect(submitted).toBe(1));
    expect(calls.map((c) => c.key)).toEqual(['POST /me/kyc/documents?kind=id', 'POST /me/kyc']);
    expect(calls[1]!.body).toMatchObject({ type: 'individual', legalName: 'Mikey Test', idDocumentKey: 'idkey.png', payoutMethod: 'mtn_momo', payoutPhone: '677000000', payoutAccountName: 'Mikey Test' });
  });
});

describe('PayoutPanel', () => {
  const setup = (withdrawable = 5520) => {
    routes = {
      'GET /me/balance': () => ({ json: { balance: { totalXaf: 5520, withdrawableXaf: withdrawable, inFlightXaf: 0, lockedXaf: 5520 - withdrawable, minPayoutXaf: 5000, delayHours: 72, kycStatus: 'approved' } } }),
      'GET /payouts': () => ({ json: { payouts: [] } }),
      'GET /payouts/quote?amountXaf=5000': () => ({ json: { amountXaf: 5000, feeXaf: 100, netXaf: 4900 } }),
      'POST /payouts/otp': () => ({ json: { devCode: '654321' } }),
      'POST /payouts': () => ({ status: 201, json: { payout: { status: 'succeeded', netXaf: 4900 } } }),
    };
    return render(<PayoutPanel payoutPhone="+237** *** *56" />);
  };

  it('bloque un montant sous le minimum ou au-dessus du solde retirable', async () => {
    setup();
    const input = await screen.findByLabelText(/Montant à retirer/);
    const ask = screen.getByRole('button', { name: /Recevoir un code/ }) as HTMLButtonElement;
    fireEvent.change(input, { target: { value: '1000' } });
    expect(screen.getByText(/Le minimum est de/)).toBeTruthy(); expect(ask.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '9000' } });
    expect(screen.getByText(/supérieur à ton solde retirable/)).toBeTruthy(); expect(ask.disabled).toBe(true);
  });

  it('montant -> frais affichés -> code SMS -> retrait confirmé avec le code saisi', async () => {
    setup();
    fireEvent.change(await screen.findByLabelText(/Montant à retirer/), { target: { value: '5000' } });
    await screen.findByText(/Tu reçois/);
    expect(screen.getByText(/4\s?900\s?FCFA/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Recevoir un code/ }));
    await screen.findByText(/Mode test : code 654321/);
    fireEvent.change(screen.getByLabelText('Code de confirmation'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmer le retrait/ }));
    await screen.findByText(/envoyés sur ton compte Mobile Money/);
    expect(calls.find((c) => c.key === 'POST /payouts')!.body).toEqual({ amountXaf: 5000, code: '654321' });
  });
});

describe('AdminPanel', () => {
  const renderAs = (role: 'creator' | 'admin') => render(<MeContext.Provider value={me(role)}><AdminPanel /></MeContext.Provider>);

  it('refuse l\'accès à un utilisateur ordinaire, sans aucun appel à l\'API', () => {
    routes = {}; renderAs('creator');
    expect(screen.getByText('Accès réservé')).toBeTruthy(); expect(calls).toHaveLength(0);
  });

  it('validation d\'un dossier KYC : la confirmation du nom est obligatoire', async () => {
    routes = {
      'GET /admin/overview': () => ({ json: { overview: { pendingKyc: 1, refundsDue: 0, openFraudFlags: 0, payoutsInFlight: 0, payoutsFailed7d: 0, unprocessedWebhooks: 0, activeContests: 2, ledgerImbalanceXaf: 0 } } }),
      'GET /admin/kyc?status=pending': () => ({ json: { items: [{ id: 'k1', legalName: 'Mikey Test', type: 'individual', fullName: 'Mikey', submittedAt: '2026-10-28T10:00:00Z' }] } }),
      'GET /admin/kyc/k1': () => ({ json: { kyc: { id: 'k1', legalName: 'Mikey Test', status: 'pending', payoutMethod: 'mtn_momo', payoutPhone: '+237677123456', payoutAccountName: 'MIKEY TEST' }, documents: [{ label: 'Carte nationale d\'identité', key: 'abc.png' }] } }),
      'POST /admin/kyc/k1/approve': () => ({ json: { ok: true } }),
    };
    renderAs('admin');
    await screen.findByText(/Grand livre équilibré/);
    fireEvent.click(screen.getByRole('tab', { name: 'Identités' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Examiner' }));
    const approve = await screen.findByRole('button', { name: 'Valider le dossier' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect((screen.getByRole('link', { name: /Ouvrir : Carte nationale/ }) as HTMLAnchorElement).getAttribute('href')).toBe('/api/admin/files/abc.png');
    fireEvent.click(screen.getByRole('checkbox'));
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /admin/kyc/k1/approve')).toBe(true));
    expect(calls.find((c) => c.key === 'POST /admin/kyc/k1/approve')!.body).toEqual({ nameChecked: true });
  });

  it('alerte visible si le grand livre est déséquilibré', async () => {
    routes = { 'GET /admin/overview': () => ({ json: { overview: { pendingKyc: 0, refundsDue: 0, openFraudFlags: 0, payoutsInFlight: 0, payoutsFailed7d: 0, unprocessedWebhooks: 0, activeContests: 0, ledgerImbalanceXaf: 250 } } }) };
    renderAs('admin');
    await screen.findByText(/Grand livre déséquilibré/);
  });
});
