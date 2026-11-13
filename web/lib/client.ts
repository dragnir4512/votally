export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number, public details?: string) {
    super(message); this.name = 'ApiError';
  }
}

let refreshInFlight: Promise<boolean> | null = null;
async function renewSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch('/api/auth/refresh', { method: 'POST', cache: 'no-store' })
      .then((r) => r.ok).catch(() => false).finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

/** Appels navigateur -> /api/... ; renouvelle une session expirée une seule fois avant de réessayer. */
export async function api<T>(path: string, init: {
  method?: string; body?: unknown; headers?: Record<string, string>;
} = {}): Promise<T> {
  const method = init.method ?? (init.body ? 'POST' : 'GET');
  const send = () => fetch('/api' + path, {
    method,
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  let res: Response;
  try {
    res = await send();
    const excluded = ['/auth/login', '/auth/register', '/auth/verify', '/auth/refresh', '/auth/logout'];
    if (res.status === 401 && !excluded.includes(path) && await renewSession()) res = await send();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur réseau inconnue';
    throw new ApiError(`Impossible de joindre le serveur VOTALLY : ${message}`, 'network_error', 0);
  }
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try { json = JSON.parse(text); }
    catch { throw new ApiError(`Le serveur a renvoyé une réponse invalide (HTTP ${res.status}).`, 'invalid_response', res.status); }
  }
  if (!res.ok) {
    const data = json as { error?: { message?: string; code?: string; details?: { path: string; message: string }[] } } | null;
    const details = data?.error?.details?.map((item) => item.message).join(' · ');
    throw new ApiError(data?.error?.message ?? `Erreur HTTP ${res.status}`, data?.error?.code ?? 'error', res.status, details);
  }
  if (json === null) throw new ApiError(`Le serveur a renvoyé une réponse vide (HTTP ${res.status}).`, 'empty_response', res.status);
  return json as T;
}
