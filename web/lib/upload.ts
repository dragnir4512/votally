import { ApiError } from './client';

export const MAX_FILE = 8 * 1024 * 1024;

/** Envoie un fichier tel quel (corps brut). Le serveur le reconnaît par son contenu et le traite. */
export async function uploadFile<T>(path: string, file: File, accept: 'image' | 'document' = 'image'): Promise<T> {
  if (file.size > MAX_FILE) throw new ApiError('Fichier trop volumineux (8 Mo maximum)', 'too_large', 413);
  const okType = accept === 'image' ? file.type.startsWith('image/') : file.type.startsWith('image/') || file.type === 'application/pdf';
  if (!okType) throw new ApiError(accept === 'image' ? 'Choisis une image (JPEG, PNG ou WebP)' : 'Choisis une image ou un PDF', 'bad_type', 415);
  const res = await fetch('/api' + path, { method: 'POST', headers: { 'content-type': file.type }, body: file });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.error?.message ?? 'Envoi impossible', json?.error?.code ?? 'error', res.status);
  return json as T;
}
