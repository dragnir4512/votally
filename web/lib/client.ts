export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number, public details?: string) { super(message); }
}

/** Appels navigateur -> /api/... (proxy Next vers l'API). */
export async function api<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch('/api' + path, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...init.headers },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const d = json?.error?.details as { path: string; message: string }[] | undefined;   // erreurs de validation de l'API
    throw new ApiError(json?.error?.message ?? 'Erreur', json?.error?.code ?? 'error', res.status, d?.map((x) => x.message).join(' · '));
  }
  return json as T;
}
