// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VoteSheet from '../components/VoteSheet';
import { makeT } from '../lib/i18n';
import type { Candidate, ContestPublic, Pack } from '../lib/types';

const contest = (over: Partial<ContestPublic> = {}): ContestPublic => ({
  id: 'c1', name: 'Miss Test', slug: 'x', description: null, rules: null, organizerName: null, status: 'active', voteType: 'paid', votePriceXaf: 100,
  currency: 'XAF', startsAt: null, endsAt: null, maxChoicesPerVote: 2, freeVotesPerPeriod: 1, freeVotePeriodHours: 24, resultsDisplay: 'realtime',
  defaultLocale: 'fr', theme: {}, bannerKey: null, ...over });
const cands: Candidate[] = [
  { id: 'a', number: 1, name: 'Alice', description: null, imageKey: null },
  { id: 'b', number: 2, name: 'Bella', description: null, imageKey: null }];
const packs: Pack[] = [{ id: 'p10', label: null, votesCount: 10, priceXaf: 900 }];

type Handler = (body: any) => { status?: number; json: unknown };
let routes: Record<string, Handler>; let calls: { url: string; body: any; headers: any }[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body, headers: init?.headers });
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    if (!key) return new Response(JSON.stringify({ error: { code: 'nf', message: 'nf' } }), { status: 404 });
    const r = routes[key]!(body);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const sheet = (c: ContestPublic, sel = cands.slice(0, 1)) =>
  render(<VoteSheet contest={c} packs={packs} selected={sel} lang="fr" tt={makeT('fr')} shareUrl="https://x.votally.com" onClose={() => undefined} />);

describe('VoteSheet — vote gratuit', () => {
  it('téléphone -> code SMS -> vote enregistré', async () => {
    routes = {
      '/otp': () => ({ json: { devCode: '123456' } }),
      '/votes/free': () => ({ status: 201, json: { reference: 'VT-FREE', votes: 1, status: 'confirmed' } }),
    };
    sheet(contest({ voteType: 'free', votePriceXaf: 0 }));
    const send = screen.getByRole('button', { name: /Recevoir mon code/ });
    expect((send as HTMLButtonElement).disabled).toBe(true);                         // numéro vide
    fireEvent.change(screen.getByPlaceholderText(/690 00 00 00/), { target: { value: '12' } });
    expect(screen.getByText(/Numéro invalide/)).toBeTruthy();                        // numéro trop court
    fireEvent.change(screen.getByPlaceholderText(/690 00 00 00/), { target: { value: '690000000' } });
    fireEvent.click(send);
    await screen.findByText(/Mode test : code 123456/);
    fireEvent.change(screen.getByPlaceholderText('••••••'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer mon vote' }));
    await screen.findByText(/Merci, ton vote est enregistré/);
    expect(calls.at(-1)!.body).toMatchObject({ phone: '690000000', code: '123456', choices: [{ candidateId: 'a', quantity: 1 }] });
  });

  it('affiche l\'erreur traduite quand le code est refusé par l\'API', async () => {
    routes = { '/otp': () => ({ status: 429, json: { error: { code: 'otp_throttled', message: 'Patiente 60 secondes' } } }) };
    sheet(contest({ voteType: 'free' }));
    fireEvent.change(screen.getByPlaceholderText(/690 00 00 00/), { target: { value: '690000000' } });
    fireEvent.click(screen.getByRole('button', { name: /Recevoir mon code/ }));
    await screen.findByText('Patiente une minute avant de redemander un code.');
  });

  it('limite les choix selon maxChoicesPerVote, indépendamment du quota gratuit par période', () => {
    routes = {};
    sheet(contest({ voteType: 'free', freeVotesPerPeriod: 5, maxChoicesPerVote: 1 }), cands);
    expect(screen.getByText(/tu peux voter pour 1 candidat\(s\) à la fois/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/690 00 00 00/), { target: { value: '690000000' } });
    expect((screen.getByRole('button', { name: /Recevoir mon code/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('autorise plusieurs choix si maxChoicesPerVote le permet même avec un quota périodique de un', () => {
    routes = {};
    sheet(contest({ voteType: 'free', votePriceXaf: 0, freeVotesPerPeriod: 1, maxChoicesPerVote: 2 }), cands);
    fireEvent.change(screen.getByPlaceholderText(/690 00 00 00/), { target: { value: '690000000' } });
    expect(screen.queryByText(/tu peux voter pour/)).toBeNull();
    expect((screen.getByRole('button', { name: /Recevoir mon code/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('VoteSheet — vote payant', () => {
  it('devis -> paiement -> attente -> confirmation par interrogation', async () => {
    let polls = 0;
    routes = {
      '/quote': (b) => ({ json: { votes: b.choices.reduce((s: number, c: any) => s + c.quantity, 0), subtotalXaf: 100, feeXaf: 3, totalXaf: 103 } }),
      '/orders': () => ({ status: 201, json: { reference: 'VT-PAY', status: 'pending', totalXaf: 103, expiresAt: new Date(Date.now() + 600_000).toISOString() } }),
      '/orders/VT-PAY': () => ({ json: { order: { status: ++polls >= 2 ? 'confirmed' : 'pending' } } }),
    };
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sheet(contest());
    fireEvent.change(screen.getByPlaceholderText(/690 00 00 00/), { target: { value: '677000111' } });
    const pay = await screen.findByRole('button', { name: /Payer 103 FCFA/ });          // le total vient du devis serveur (jamais calculé ici)
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    fireEvent.click(pay);
    await screen.findByText('Valide le paiement sur ton téléphone');
    const order = calls.find((c) => c.url.endsWith('/orders') && c.body?.method)!;
    expect(order.body).toMatchObject({ method: 'mtn_momo', phone: '677000111', choices: [{ candidateId: 'a', quantity: 1 }] });
    expect(order.body.total).toBeUndefined();                                              // aucun montant envoyé par le navigateur
    expect(String((order.headers as any)['Idempotency-Key']).length).toBeGreaterThan(20);
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });                  // 1er suivi : encore en attente
    expect(screen.queryByText(/Merci, ton vote/)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });                  // 2e suivi : confirmé
    await screen.findByText(/Merci, ton vote est enregistré/);
    expect(screen.getByText(/VT-PAY/)).toBeTruthy();
  });

  it('un pack est appliqué quand le total de votes correspond, et une commande échouée propose de réessayer', async () => {
    routes = {
      '/quote': (b) => ({ json: { votes: 10, subtotalXaf: b.packId ? 900 : 1000, feeXaf: 23, totalXaf: (b.packId ? 900 : 1000) + 23 } }),
      '/orders': () => ({ status: 201, json: { reference: 'VT-F2', status: 'pending', totalXaf: 923, expiresAt: new Date(Date.now() + 600_000).toISOString() } }),
      '/orders/VT-F2': () => ({ json: { order: { status: 'failed' } } }),
    };
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sheet(contest());
    fireEvent.click(screen.getByRole('button', { name: /10 votes/ }));                  // pack de 10 votes à 900 FCFA
    fireEvent.click(screen.getByLabelText('Carte bancaire'));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(calls.filter((c) => c.url.endsWith('/quote')).at(-1)!.body).toMatchObject({ packId: 'p10', method: 'card' });
    const pay = await screen.findByRole('button', { name: /Payer \d.*923 FCFA|Payer .*923/ });
    fireEvent.click(pay);                                                                  // carte : aucun numéro requis
    await screen.findByText('Valide le paiement sur ton téléphone');
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    await screen.findByText('Paiement non abouti');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Payer/ })).toBeTruthy());
  });
});
