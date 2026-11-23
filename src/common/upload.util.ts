// src/common/upload.util.ts
// Utilidades compartidas para TODAS las subidas de imágenes (cursos, campañas,
// foto de perfil).
//
// SEGURIDAD: antes el nombre guardado conservaba la extensión original del
// usuario y solo se revisaba el Content-Type (que controla el cliente). Eso
// permitía subir "x.html"/"x.js" disfrazados de imagen y servirlos desde
// /uploads en el mismo dominio (XSS → robo de sesión del admin). Ahora:
//   1. La extensión se deriva SOLO del tipo permitido (.jpg/.png/.webp/.gif).
//   2. El nombre es aleatorio (no se usa el nombre original).
//   3. Tras guardar, se leen los magic bytes y deben coincidir con el tipo.
import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as fs from 'fs';

export const IMAGE_MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/** Extensiones que /uploads puede mostrar en línea; el resto se fuerza a descarga. */
export const INLINE_UPLOAD_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

/** Callback `filename` de multer: nombre aleatorio + extensión según el tipo. */
export function imageFilename(prefix = '') {
  return (_req: any, file: Express.Multer.File, cb: (err: Error | null, name: string) => void) => {
    const ext = IMAGE_MIME_EXT[file.mimetype] || '.bin';
    cb(null, `${prefix}${Date.now()}-${randomBytes(6).toString('hex')}${ext}`);
  };
}

/** `fileFilter` de multer: solo tipos de imagen permitidos. */
export function imageFileFilter(_req: any, file: Express.Multer.File, cb: any) {
  if (!IMAGE_MIME_EXT[file.mimetype]) {
    return cb(new BadRequestException('Solo se permiten imágenes JPEG, PNG, WebP o GIF'), false);
  }
  cb(null, true);
}

/** Detecta el tipo real de imagen por magic bytes. */
export function detectImageMime(buffer?: Buffer): string | null {
  if (!buffer || buffer.length < 4) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return 'image/webp';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif';
  return null;
}

function readHeader(file: Express.Multer.File): Buffer | undefined {
  if (file.buffer && file.buffer.length >= 12) return file.buffer;
  if (!file.path) return file.buffer;
  try {
    const fd = fs.openSync(file.path, 'r');
    try {
      const tmp = Buffer.alloc(12);
      const n = fs.readSync(fd, tmp, 0, 12, 0);
      return tmp.subarray(0, n);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

function removeFile(file: Express.Multer.File) {
  if (file?.path) {
    try { fs.unlinkSync(file.path); } catch { /* ignore */ }
  }
}

/**
 * Verifica que el archivo subido sea realmente una imagen del tipo declarado.
 * Si no lo es, lo borra del disco y lanza 400.
 */
export function ensureValidImage(file?: Express.Multer.File): void {
  if (!file) return;
  const real = detectImageMime(readHeader(file));
  if (!real || real !== file.mimetype) {
    removeFile(file);
    throw new BadRequestException('El archivo no es una imagen válida');
  }
}

/** Igual que ensureValidImage para varios archivos: si uno falla, borra todos. */
export function ensureValidImages(files?: Express.Multer.File[]): void {
  const list = files || [];
  for (const f of list) {
    const real = detectImageMime(readHeader(f));
    if (!real || real !== f.mimetype) {
      list.forEach(removeFile);
      throw new BadRequestException(`"${f.originalname}" no es una imagen válida`);
    }
  }
}
