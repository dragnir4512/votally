import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

/** Stockage de fichiers. Implémentation disque pour le développement et un serveur unique ;
 *  en production, écrire un adaptateur S3 / stockage objet avec la même interface. */
export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

const KEY = /^[a-f0-9]{32}\.(webp|jpg|png|pdf)$/;     // aucune clé arbitraire : pas de traversée de dossier possible

class LocalStorage implements Storage {
  constructor(private root: string) {}
  private file(key: string) { if (!KEY.test(key)) throw new Error('Clé de fichier invalide'); return path.join(this.root, key); }
  async put(key: string, data: Buffer) { await mkdir(this.root, { recursive: true }); await writeFile(this.file(key), data, { flag: 'wx' }); }
  async get(key: string) {
    try { return await readFile(this.file(key)); } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
  }
}

export const storage: Storage = new LocalStorage(path.resolve(config.UPLOAD_DIR));
export const isValidKey = (k: string) => KEY.test(k);
