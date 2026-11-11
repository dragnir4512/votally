import sharp from 'sharp';
import { HttpError } from './http.js';

const LIMIT = { limitInputPixels: 40_000_000 };       // refuse les « bombes » de décompression

/** Photo publique : lecture sûre, rotation EXIF appliquée puis métadonnées supprimées, recadrage et conversion WebP. */
export async function processImage(buf: Buffer, kind: 'candidate' | 'banner' | 'logo'): Promise<Buffer> {
  let format: string | undefined;
  try { format = (await sharp(buf, LIMIT).metadata()).format; } catch { throw new HttpError(415, 'Image illisible', 'bad_image'); }
  if (!format || !['jpeg', 'png', 'webp'].includes(format)) throw new HttpError(415, 'Formats acceptés : JPEG, PNG, WebP', 'bad_image');
  const [width, height] = kind === 'candidate' ? [800, 800] : kind === 'logo' ? [600, 600] : [1600, 600];
  return sharp(buf, LIMIT).rotate().resize({ width, height, fit: 'cover' }).webp({ quality: 80 }).toBuffer();
}

/** Pièce justificative (KYC) : image ou PDF reconnus par leur CONTENU (jamais par le nom ou l'en-tête du client). */
export async function sniffDocument(buf: Buffer): Promise<{ ext: 'jpg' | 'png' | 'webp' | 'pdf'; contentType: string }> {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return { ext: 'pdf', contentType: 'application/pdf' };
  try {
    const f = (await sharp(buf, LIMIT).metadata()).format;
    if (f === 'jpeg') return { ext: 'jpg', contentType: 'image/jpeg' };
    if (f === 'png') return { ext: 'png', contentType: 'image/png' };
    if (f === 'webp') return { ext: 'webp', contentType: 'image/webp' };
  } catch { /* illisible */ }
  throw new HttpError(415, 'Formats acceptés : PDF, JPEG, PNG, WebP', 'bad_document');
}
