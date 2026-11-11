// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CandidatesTab from '../components/creator/CandidatesTab';
import ContestAdmin from '../components/creator/ContestAdmin';
import ContestForm from '../components/creator/ContestForm';
import { buildPayload, emptyForm, formFromContest, parseBulk, publishChecklist, toInput, type MyCandidate, type MyContest } from '../lib/creator';
import { safeNext } from '../lib/session';

const contest = (over: Partial<MyContest> = {}): MyContest => ({
  id: 'c1', name: 'Miss Test', slug: 'miss-test', description: null, rules: 'Règlement', organizerName: null, status: 'draft', voteType: 'paid', votePriceXaf: 100,
  startsAt: null, endsAt: null, visibility: 'public', hasPassword: false, resultsDisplay: 'realtime', maxChoicesPerVote: 2, freeVotesPerPeriod: 1,
  freeVotePeriodHours: 24, defaultLocale: 'fr', theme: { primaryColor: '#112233' }, ...over });
const cand = (n: number, active = true): MyCandidate => ({ id: `k${n}`, number: n, name: `Candidat ${n}`, description: null, imageKey: null, isActive: active });

let routes: Record<string, (body: any) => { status?: number; json?: unknown }>; let calls: { key: string; body: any }[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url.replace(/^\/api/, '')}`;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ key, body });
    const h = routes[key];
    if (!h) return new Response(JSON.stringify({ error: { code: 'nf', message: `route non simulée : ${key}` } }), { status: 404 });
    const r = h(body);
    return new Response(r.status === 204 ? null : JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  }));
  vi.stubGlobal('confirm', () => true);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('utilitaires organisateur', () => {
  it('parseBulk : une ligne = un candidat, « ; » ou tabulation avant la description', () => {
    expect(parseBulk('Aïcha ; Étudiante\n\n  Brenda  \nChantal\tInfirmière\n;\n')).toEqual([
      { name: 'Aïcha', description: 'Étudiante' }, { name: 'Brenda' }, { name: 'Chantal', description: 'Infirmière' }]);
    expect(parseBulk('')).toEqual([]);
    expect(parseBulk(Array.from({ length: 600 }, (_, i) => `C${i}`).join('\n'))).toHaveLength(500);
  });

  it('buildPayload : les champs verrouillés ne sont jamais envoyés après publication', () => {
    const v = { ...emptyForm, name: ' Miss Test ', voteType: 'paid' as const, votePriceXaf: '250', maxChoicesPerVote: '3' };
    const open = buildPayload(v, { locked: false });
    expect(open).toMatchObject({ name: 'Miss Test', voteType: 'paid', votePriceXaf: 250, maxChoicesPerVote: 3, description: null });
    const locked = buildPayload(v, { locked: true });
    for (const k of ['voteType', 'votePriceXaf', 'maxChoicesPerVote']) expect(locked).not.toHaveProperty(k);
  });

  it('buildPayload : gratuit => prix 0 ; public => mot de passe effacé ; thème conservé', () => {
    expect(buildPayload({ ...emptyForm, name: 'Abc', voteType: 'free', votePriceXaf: '500' }, { locked: false })).toMatchObject({ voteType: 'free', votePriceXaf: 0, accessPassword: null });
    const priv = buildPayload({ ...emptyForm, name: 'Abc', visibility: 'private', accessPassword: '' }, { locked: false });
    expect(priv).not.toHaveProperty('accessPassword');                                   // vide = conserver l'actuel
    expect(buildPayload({ ...emptyForm, name: 'Abc', primaryColor: '#abcdef' }, { locked: false, existingTheme: { banner: 'x' } }).theme).toEqual({ banner: 'x', primaryColor: '#abcdef' });
  });

  it('dates : aller-retour datetime-local <-> ISO', () => {
    const iso = new Date(2026, 10, 5, 14, 30).toISOString();
    expect(toInput(iso)).toBe('2026-11-05T14:30');
    expect(buildPayload({ ...emptyForm, name: 'Abc', startsAt: '2026-11-05T14:30' }, { locked: false }).startsAt).toBe(iso);
    expect(formFromContest(contest({ startsAt: iso })).startsAt).toBe('2026-11-05T14:30');
  });

  it('liste de contrôle avant publication', () => {
    expect(publishChecklist(contest({ rules: '' }), 1).map((c) => c.ok)).toEqual([false, false, true]);
    expect(publishChecklist(contest(), 2).every((c) => c.ok)).toBe(true);
    expect(publishChecklist(contest({ endsAt: new Date(Date.now() - 1000).toISOString() }), 2)[2]!.ok).toBe(false);
  });

  it('safeNext refuse les redirections vers un autre site', () => {
    expect(safeNext('/espace/abc')).toBe('/espace/abc');
    for (const bad of ['https://evil.com', '//evil.com', 'javascript:alert(1)', '/\\evil.com', null]) expect(safeNext(bad as string | null)).toBe('/espace');
  });
});

describe('ContestAdmin', () => {
  const setup = (role: 'owner' | 'viewer', c: MyContest, cands: MyCandidate[]) => {
    routes = {
      'GET /contests/c1': () => ({ json: { contest: c, myRole: role } }),
      'GET /contests/c1/candidates': () => ({ json: { candidates: cands } }),
      'GET /contests/c1/dashboard': () => ({ json: { dashboard: { validVotes: 12, paidVotes: 10, freeVotes: 2, pendingOrders: 1, openFraudFlags: 0,
        ...(role === 'owner' ? { grossXaf: 1000, commissionXaf: 80, netXaf: 920, balanceXaf: 920 } : {}) } } }),
    };
    return render(<ContestAdmin id="c1" />);
  };

  it('le propriétaire voit les finances d\'un concours payant, pas l\'observateur', async () => {
    setup('owner', contest({ status: 'active' }), [cand(1), cand(2)]);
    await screen.findByText('Finances du concours');
    expect(await screen.findByText(/920\s?FCFA/)).toBeTruthy();                           // solde du concours
    cleanup();
    setup('viewer', contest({ status: 'active' }), [cand(1), cand(2)]);
    await screen.findByText('votes valides');
    expect(screen.queryByText('Finances du concours')).toBeNull();
    expect(screen.queryByText('Gérer le concours')).toBeNull();
  });

  it('publication bloquée tant que la liste de contrôle n\'est pas complète, puis active le concours', async () => {
    setup('owner', contest({ status: 'draft' }), [cand(1)]);
    const publish = await screen.findByRole('button', { name: 'Publier le concours' });
    expect((publish as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Au moins 2 candidats \(1 actuellement\)/)).toBeTruthy();
    cleanup();

    setup('owner', contest({ status: 'draft' }), [cand(1), cand(2)]);
    routes['POST /contests/c1/actions/activate'] = () => ({ json: { contest: contest({ status: 'active' }) } });
    const ready = await screen.findByRole('button', { name: 'Publier le concours' });
    await waitFor(() => expect((ready as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(ready);
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /contests/c1/actions/activate')).toBe(true));
  });
});

describe('CandidatesTab / ContestForm', () => {
  it('importe une liste collée : un seul appel avec les candidats analysés', async () => {
    let reloaded = 0;
    routes = { 'POST /contests/c1/candidates': () => ({ status: 201, json: { candidates: [] } }) };
    render(<CandidatesTab contest={contest()} candidates={[]} canEdit reload={async () => { reloaded++; }} />);
    fireEvent.change(screen.getByLabelText('Liste de candidats'), { target: { value: 'Aïcha ; Étudiante\nBrenda' } });
    fireEvent.click(screen.getByRole('button', { name: /Importer 2 candidat/ }));
    await waitFor(() => expect(reloaded).toBe(1));
    expect(calls.at(-1)!.body).toEqual([{ name: 'Aïcha', description: 'Étudiante' }, { name: 'Brenda' }]);
  });

  it('après publication : suppression impossible (désactivation seulement) et observateur sans boutons', () => {
    routes = {};
    const { unmount } = render(<CandidatesTab contest={contest({ status: 'active' })} candidates={[cand(1)]} canEdit reload={async () => undefined} />);
    expect(screen.queryByRole('button', { name: 'Supprimer' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Désactiver' })).toBeTruthy();
    unmount();
    render(<CandidatesTab contest={contest()} candidates={[cand(1)]} canEdit={false} reload={async () => undefined} />);
    expect(screen.queryByRole('button', { name: 'Modifier' })).toBeNull();
  });

  it('formulaire verrouillé : type de vote désactivé et absent de la requête', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<ContestForm initial={formFromContest(contest({ status: 'active' }))} locked submitLabel="Enregistrer" onSubmit={onSubmit} />);
    for (const r of screen.getAllByRole('radio')) expect(r.matches(':disabled')).toBe(true);   // désactivé via le fieldset parent
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const body = (onSubmit.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(body).not.toHaveProperty('voteType'); expect(body).toMatchObject({ name: 'Miss Test' });
  });
});
