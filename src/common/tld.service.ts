// src/common/tld.service.ts
// Valida el TLD (extensión de dominio) contra la lista oficial de IANA.
// - Carga una copia local incluida en el proyecto (siempre disponible, sin red).
// - Al arrancar intenta refrescarla desde IANA en segundo plano (si hay internet).
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as https from 'https';

const IANA_URL = 'https://data.iana.org/TLD/tlds-alpha-by-domain.txt';
const LOCAL_FILE = join(__dirname, 'data', 'tlds-alpha-by-domain.txt');

@Injectable()
export class TldService implements OnModuleInit {
  private readonly logger = new Logger(TldService.name);
  private tlds = new Set<string>();

  onModuleInit() {
    this.cargarLocal();
    // Refresco desde IANA en segundo plano (no bloquea el arranque)
    this.refrescarDesdeIana().catch(() => undefined);
  }

  /** Carga la copia local incluida en el proyecto. */
  private cargarLocal() {
    try {
      const contenido = readFileSync(LOCAL_FILE, 'utf8');
      this.parsear(contenido);
      this.logger.log(`✅ TLDs cargados (local): ${this.tlds.size}`);
    } catch (e: any) {
      this.logger.warn(`No se pudo cargar la lista local de TLDs: ${e.message}`);
    }
  }

  /** Descarga la lista actualizada desde IANA y reemplaza en memoria. */
  private refrescarDesdeIana(): Promise<void> {
    return new Promise((resolve) => {
      const req = https.get(IANA_URL, { timeout: 8000 }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve();
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const antes = this.tlds.size;
          this.parsear(data);
          if (this.tlds.size >= antes) {
            this.logger.log(`🔄 TLDs actualizados desde IANA: ${this.tlds.size}`);
          }
          resolve();
        });
      });
      req.on('error', () => resolve());
      req.on('timeout', () => {
        req.destroy();
        resolve();
      });
    });
  }

  private parsear(contenido: string) {
    const set = new Set<string>();
    for (const linea of contenido.split(/\r?\n/)) {
      const t = linea.trim().toLowerCase();
      if (!t || t.startsWith('#')) continue;
      set.add(t);
    }
    if (set.size > 100) this.tlds = set; // sanity check
  }

  /** ¿El TLD del dominio existe en la lista de IANA? */
  isValidTld(dominio: string): boolean {
    if (this.tlds.size === 0) return true; // si no cargó la lista, no bloquear
    const partes = (dominio || '').toLowerCase().split('.');
    const tld = partes[partes.length - 1];
    return !!tld && this.tlds.has(tld);
  }

  get cargado(): boolean {
    return this.tlds.size > 0;
  }
}
