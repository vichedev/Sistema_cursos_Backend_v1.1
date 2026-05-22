// src/whatsapp/whatsapp.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';
import * as QRCode from 'qrcode';
import { SettingsService } from '../settings/settings.service';

// Baileys es ESM puro; este truco evita que TypeScript lo transpile a require()
// (que rompería la carga). Carga el módulo ESM en tiempo de ejecución.
const importESM = new Function('m', 'return import(m)') as (m: string) => Promise<any>;

export type WaStatus = 'DISCONNECTED' | 'CONNECTING' | 'QR' | 'CONNECTED';

interface WaJob {
  jid: string;
  content: any;
  resolve: (id: string | null) => void;
  reject: (e: Error) => void;
}

/**
 * Conexión NATIVA a WhatsApp vía Baileys (multi-dispositivo, escaneo de QR).
 *
 *  • La sesión se persiste en disco (whatsapp-session/) → no hay que re-escanear
 *    el QR tras reiniciar el backend.
 *  • Todos los envíos pasan por una cola SERIAL con retardo aleatorio (jitter)
 *    entre mensajes → comportamiento humano, anti-baneo. El motor de campañas
 *    añade además pausas entre lotes.
 *  • Soporta texto e imágenes (con pie de foto).
 */
@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly sessionDir = join(process.cwd(), 'whatsapp-session');

  private sock: any = null;
  private status: WaStatus = 'DISCONNECTED';
  private qrDataUrl: string | null = null;
  private meNumber: string | null = null;
  private lastError: string | null = null;
  private starting = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  private queue: WaJob[] = [];
  private working = false;

  constructor(private settings: SettingsService) {}

  async onModuleInit() {
    if (!existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true });
    }
    // Si ya hay credenciales guardadas, intentar reconectar automáticamente.
    if (existsSync(join(this.sessionDir, 'creds.json'))) {
      this.logger.log('📱 Sesión de WhatsApp encontrada — reconectando...');
      this.start().catch((e) => this.logger.warn(`WA reconexión falló: ${e.message}`));
    } else {
      this.logger.log('📱 WhatsApp sin sesión — escanea el QR desde el panel admin');
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Conexión
  // ───────────────────────────────────────────────────────────────────────────
  async start(): Promise<void> {
    if (this.starting || this.status === 'CONNECTED') return;
    this.starting = true;
    this.lastError = null;

    try {
      const baileys = await importESM('@whiskeysockets/baileys');
      const makeWASocket = baileys.makeWASocket || baileys.default;
      const { useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } =
        baileys;

      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
      let version: any;
      try {
        ({ version } = await fetchLatestBaileysVersion());
      } catch {
        version = undefined;
      }

      this.status = 'CONNECTING';
      this.sock = makeWASocket({
        version,
        auth: state,
        logger: this.buildLogger(),
        browser: Browsers.appropriate('MAAT Academy'),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        // ── Estabilidad: tiempos más holgados para reducir timeouts (408) ──
        connectTimeoutMs: 60_000,
        keepAliveIntervalMs: 25_000,
        defaultQueryTimeoutMs: 60_000,
        retryRequestDelayMs: 2_000,
        qrTimeout: 45_000,
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.status = 'QR';
          try {
            this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, scale: 6 });
          } catch {
            this.qrDataUrl = null;
          }
          this.logger.log('📲 Nuevo QR de WhatsApp disponible para escanear');
        }

        if (connection === 'open') {
          this.status = 'CONNECTED';
          this.qrDataUrl = null;
          this.meNumber = (this.sock?.user?.id || '').split(':')[0] || null;
          this.logger.log(`✅ WhatsApp conectado como ${this.meNumber}`);
          void this.processQueue();
        }

        if (connection === 'close') {
          const code =
            lastDisconnect?.error?.output?.statusCode ??
            lastDisconnect?.error?.output?.payload?.statusCode;
          const loggedOut = code === DisconnectReason.loggedOut;
          const waitingQr = !existsSync(join(this.sessionDir, 'creds.json'));

          this.sock = null;

          if (loggedOut) {
            this.logger.warn('⚠️  WhatsApp: sesión cerrada desde el teléfono');
            this.status = 'DISCONNECTED';
            this.lastError = 'Sesión cerrada desde el teléfono';
            this.clearSession();
            return;
          }

          // 408 = tiempo de espera del QR agotado mientras nadie escanea.
          // Es comportamiento normal: regeneramos un QR nuevo sin alarmar.
          if (code === DisconnectReason.timedOut && waitingQr) {
            this.logger.log('🔄 QR expirado, generando uno nuevo...');
          } else {
            this.logger.warn(`⚠️  WhatsApp desconectado (code=${code}) — reconectando`);
          }

          this.status = 'CONNECTING';
          this.scheduleReconnect(waitingQr ? 1500 : 4000);
        }
      });
    } catch (e: any) {
      this.status = 'DISCONNECTED';
      this.lastError = e.message;
      this.logger.error(`❌ Error iniciando WhatsApp: ${e.message}`);
      throw e;
    } finally {
      this.starting = false;
    }
  }

  /** Programa una reconexión evitando timers duplicados (que crearían varios sockets). */
  private scheduleReconnect(delayMs: number) {
    if (this.reconnectTimer) return; // ya hay una reconexión pendiente
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start().catch((e) => this.logger.warn(`Reconexión WA falló: ${e.message}`));
    }, delayMs);
  }

  /** Cierra la sesión y borra credenciales (requerirá nuevo QR). */
  async logout(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      if (this.sock) await this.sock.logout();
    } catch {
      /* ignore */
    }
    this.sock = null;
    this.status = 'DISCONNECTED';
    this.qrDataUrl = null;
    this.meNumber = null;
    this.clearSession();
    this.logger.log('📱 Sesión de WhatsApp cerrada y credenciales borradas');
  }

  private clearSession() {
    try {
      if (existsSync(this.sessionDir)) {
        rmSync(this.sessionDir, { recursive: true, force: true });
        mkdirSync(this.sessionDir, { recursive: true });
      }
    } catch (e: any) {
      this.logger.warn(`No se pudo limpiar la sesión: ${e.message}`);
    }
  }

  getStatus() {
    return {
      status: this.status,
      connected: this.status === 'CONNECTED',
      qr: this.status === 'QR' ? this.qrDataUrl : null,
      me: this.meNumber,
      error: this.lastError,
      queueLength: this.queue.length,
    };
  }

  private buildLogger(): any {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pino = require('pino');
      return pino({ level: 'silent' });
    } catch {
      const stub: any = {
        level: 'silent',
        trace() {},
        debug() {},
        info() {},
        warn() {},
        error() {},
        fatal() {},
        child() {
          return stub;
        },
      };
      return stub;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Formato de número → JID
  // ───────────────────────────────────────────────────────────────────────────
  formatJid(celular: string): string | null {
    if (!celular) return null;
    let digits = celular.replace(/\D/g, '');
    if (!digits) return null;
    // Ecuador: 0XXXXXXXXX (10) → 593XXXXXXXXX
    if (digits.length === 10 && digits.startsWith('0')) {
      digits = '593' + digits.slice(1);
    } else if (digits.length === 9 && digits.startsWith('9')) {
      // 9XXXXXXXX sin código de país → asumir Ecuador
      digits = '593' + digits;
    }
    if (digits.length < 10) return null;
    return `${digits}@s.whatsapp.net`;
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Envío (encolado serial con jitter)
  // ───────────────────────────────────────────────────────────────────────────
  sendText(celular: string, text: string): Promise<string | null> {
    const jid = this.formatJid(celular);
    if (!jid) return Promise.reject(new Error(`Número inválido: ${celular}`));
    return this.enqueue(jid, { text });
  }

  sendImage(celular: string, imagePath: string, caption?: string): Promise<string | null> {
    const jid = this.formatJid(celular);
    if (!jid) return Promise.reject(new Error(`Número inválido: ${celular}`));
    return this.enqueue(jid, { image: { url: imagePath }, caption: caption || undefined });
  }

  /** Imagen + texto: WhatsApp permite imagen con pie de foto en un solo mensaje. */
  sendImageWithText(
    celular: string,
    imagePath: string,
    text: string,
  ): Promise<string | null> {
    return this.sendImage(celular, imagePath, text);
  }

  private enqueue(jid: string, content: any): Promise<string | null> {
    return new Promise((resolve, reject) => {
      this.queue.push({ jid, content, resolve, reject });
      void this.processQueue();
    });
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  private async processQueue() {
    if (this.working) return;
    if (this.status !== 'CONNECTED' || !this.sock) return; // se reanuda al conectar
    this.working = true;

    try {
      while (this.queue.length > 0 && this.status === 'CONNECTED' && this.sock) {
        const cfg = this.settings.getWhatsappConfig();
        const job = this.queue.shift() as WaJob;

        try {
          const res = await this.sock.sendMessage(job.jid, job.content);
          this.logger.log(`📱 WhatsApp enviado a ${job.jid}`);
          job.resolve(res?.key?.id || null);
        } catch (e: any) {
          this.logger.error(`❌ Error WhatsApp a ${job.jid}: ${e.message}`);
          job.reject(new Error(e.message));
        }

        if (this.queue.length > 0) {
          const min = Math.max(500, cfg.delayMinMs);
          const max = Math.max(min, cfg.delayMaxMs);
          const jitter = min + Math.floor(Math.random() * (max - min + 1));
          await this.sleep(jitter);
        }
      }
    } finally {
      this.working = false;
    }
  }
}
