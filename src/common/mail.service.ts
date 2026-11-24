import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { SettingsService } from '../settings/settings.service';

export interface MailAttachment {
  filename: string;
  path?: string;
  content?: Buffer;
  cid?: string;
  contentType?: string;
}

interface QueuedMail {
  to: string;
  subject: string;
  html: string;
  attachments?: MailAttachment[];
  resolve: () => void;
  reject: (e: Error) => void;
  attempts: number;
  /** Correos de cuenta (activación, contraseña): pasan delante de los masivos. */
  priority?: boolean;
}

export interface SendMailOptions {
  priority?: boolean;
}

/**
 * Servicio de correo con ENVÍO INTELIGENTE ANTI-BANEO:
 *
 *  1. Conexión POOL única reutilizada (maxConnections:1) en lugar de abrir una
 *     conexión nueva por cada correo → evita el tarpit/rate-limit del servidor.
 *  2. Puerto 587 con STARTTLS por defecto (el 465/TLS-implícito cuelga el
 *     handshake en mail.maat.ec).
 *  3. Cola SECUENCIAL global: todos los correos de toda la app pasan por un
 *     único worker que respeta una pausa entre mensajes y una pausa mayor entre
 *     lotes. Aunque el resto del código dispare 100 correos "en paralelo", aquí
 *     se serializan y espacian → nunca se satura el servidor.
 *  4. La configuración (servidor, credenciales, tiempos) se lee de la BD en
 *     caliente; al cambiarla se reconstruye el transporter automáticamente.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  private queue: QueuedMail[] = [];
  private working = false;
  private sentInBatch = 0;

  constructor(private settings: SettingsService) {}

  onModuleInit() {
    // Reconstruir el transporter cuando cambie la configuración SMTP/throttle.
    this.settings.onChange((group) => {
      if (group === 'smtp' || group === 'mail') {
        this.resetTransporter();
        this.logger.log('♻️  Configuración de correo actualizada — transporter reiniciado');
      }
    });

    const cfg = this.settings.getSmtpConfig();
    if (!cfg.host || !cfg.user) {
      this.logger.warn('⚠️  SMTP no configurado todavía (configúralo en el panel admin)');
      return;
    }
    this.logger.log(`📧 SMTP: ${cfg.host}:${cfg.port} ${cfg.secure ? 'TLS' : 'STARTTLS'} | usuario: ${cfg.user}`);
    this.verifyConnection()
      .then((ok) =>
        ok
          ? this.logger.log('✅ Conexión SMTP verificada correctamente')
          : this.logger.warn('⚠️  SMTP no disponible al arrancar'),
      )
      .catch(() => undefined);
  }

  private buildTransporter(): Transporter {
    const cfg = this.settings.getSmtpConfig();
    const throttle = this.settings.getMailThrottleConfig();
    return nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,            // 587 → false (STARTTLS) ; 465 → true (TLS)
      requireTLS: !cfg.secure,       // fuerza STARTTLS cuando no es TLS implícito
      auth: { user: cfg.user, pass: cfg.pass },
      tls: { rejectUnauthorized: false, servername: cfg.host },
      // Nombre con el que nos presentamos (EHLO). Por defecto sería el hostname
      // del contenedor Docker (p. ej. "3f9a1c2b7d4e"), que queda en las cabeceras
      // "Received" y los filtros antispam lo penalizan.
      name: this.ehloName(cfg.user),
      // ── Pool reutilizado: clave anti-baneo ──
      pool: true,
      maxConnections: 1,
      maxMessages: throttle.maxPerConnection,
      rateDelta: 60_000,
      rateLimit: throttle.ratePerMinute,
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 60_000,
    });
  }

  /** Dominio del remitente (cursos@maat.ec → "maat.ec") para el saludo EHLO. */
  private ehloName(user?: string): string | undefined {
    const dominio = (user || '').split('@')[1]?.trim().toLowerCase();
    return dominio && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(dominio) ? dominio : undefined;
  }

  /**
   * Versión en texto plano del HTML. Un correo SOLO-HTML (sin parte de texto)
   * es una señal típica de spam; enviar ambas versiones mejora la entrega.
   */
  static htmlToText(html: string): string {
    return (html || '')
      .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, txt) => {
        const t = txt.replace(/<[^>]+>/g, '').trim();
        return t && t !== href ? `${t}: ${href}` : href;
      })
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr|table)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<hr[^>]*>/gi, '\n----------\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&middot;/gi, '·')
      .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private getTransporter(): Transporter {
    if (!this.transporter) this.transporter = this.buildTransporter();
    return this.transporter;
  }

  private resetTransporter() {
    if (this.transporter) {
      try {
        this.transporter.close();
      } catch {
        /* ignore */
      }
    }
    this.transporter = null;
  }

  /** Verifica la conexión SMTP con la config actual. No lanza. */
  async verifyConnection(): Promise<boolean> {
    try {
      await this.getTransporter().verify();
      return true;
    } catch (e: any) {
      this.logger.warn(`SMTP verify falló: ${e.message}`);
      this.resetTransporter();
      return false;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  API PÚBLICA — todo encola en el worker secuencial
  // ───────────────────────────────────────────────────────────────────────────
  sendMail(
    to: string,
    subject: string,
    html: string,
    attachments?: MailAttachment[],
    opts: SendMailOptions = {},
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.enqueue({
        to, subject, html, attachments, resolve, reject, attempts: 0, priority: !!opts.priority,
      });
      void this.processQueue();
    });
  }

  /**
   * Inserta en la cola. Los prioritarios van detrás de los demás prioritarios
   * pero DELANTE de los masivos (avisos de curso, material, etc.), así un correo
   * de activación no espera a que terminen cientos de notificaciones. Las pausas
   * anti-baneo entre mensajes se siguen respetando igual.
   */
  private enqueue(item: QueuedMail) {
    if (!item.priority) {
      this.queue.push(item);
      return;
    }
    const firstNormal = this.queue.findIndex((q) => !q.priority);
    if (firstNormal === -1) this.queue.push(item);
    else this.queue.splice(firstNormal, 0, item);
  }

  getQueueStatus() {
    return {
      queueLength: this.queue.length,
      priorityPending: this.queue.filter((q) => q.priority).length,
      working: this.working,
    };
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  private async processQueue() {
    if (this.working) return;
    this.working = true;

    try {
      while (this.queue.length > 0) {
        const cfg = this.settings.getMailThrottleConfig();
        const item = this.queue.shift() as QueuedMail;

        try {
          await this.deliver(item);
          item.resolve();
        } catch (e: any) {
          // Reintento con backoff dentro de la misma cola (máx 3)
          item.attempts += 1;
          if (item.attempts < 3) {
            this.logger.warn(`⚠️  Reintento ${item.attempts}/3 para ${item.to}: ${e.message}`);
            this.resetTransporter();
            await this.sleep(5000 * item.attempts);
            this.enqueue(item); // al final (o al final de los prioritarios)
          } else {
            this.logger.error(`❌ No se pudo enviar a ${item.to} tras 3 intentos: ${e.message}`);
            item.reject(new Error(`Fallo al enviar correo a ${item.to}: ${e.message}`));
          }
          continue;
        }

        this.sentInBatch += 1;

        if (this.queue.length > 0) {
          if (this.sentInBatch >= cfg.batchSize) {
            this.sentInBatch = 0;
            this.logger.log(`⏸️  Pausa de lote (${cfg.batchPauseMs / 1000}s) para evitar baneo`);
            await this.sleep(cfg.batchPauseMs);
          } else {
            await this.sleep(cfg.delayMs);
          }
        }
      }
    } finally {
      this.working = false;
    }
  }

  private async deliver(item: QueuedMail) {
    await this.deliverRaw(item.to, item.subject, item.html, item.attachments);
  }

  private async deliverRaw(
    to: string,
    subject: string,
    html: string,
    attachments?: MailAttachment[],
  ) {
    const cfg = this.settings.getSmtpConfig();
    const t0 = Date.now();
    await this.getTransporter().sendMail({
      from: `"${cfg.fromName}" <${cfg.user}>`,
      to,
      subject,
      html,
      text: MailService.htmlToText(html),
      attachments,
    });
    this.logger.log(`✅ Correo enviado a ${to} en ${Date.now() - t0}ms`);
  }

  /**
   * Envío DIRECTO (sin pasar por la cola interna), con reintentos. Lo usa el
   * motor de campañas, que controla su propio ritmo de lotes. La conexión pool
   * (maxConnections:1) garantiza la serialización física aunque se llame seguido.
   */
  async sendMailNow(
    to: string,
    subject: string,
    html: string,
    attachments?: MailAttachment[],
  ): Promise<void> {
    let lastErr: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.deliverRaw(to, subject, html, attachments);
        return;
      } catch (e: any) {
        lastErr = e;
        this.logger.warn(`⚠️  Intento ${attempt}/3 fallido para ${to}: ${e.message}`);
        this.resetTransporter();
        if (attempt < 3) await this.sleep(4000 * attempt);
      }
    }
    throw new Error(`Fallo al enviar correo a ${to}: ${lastErr?.message}`);
  }

  /**
   * Prueba la conexión SMTP para el panel admin.
   *
   * Si los datos coinciden con la configuración ACTIVA, reutiliza la conexión
   * pool ya verificada (no abre una 2ª conexión, que el servidor tarpittearía
   * con "Greeting never received"). Si se prueban credenciales distintas, abre
   * un transporter temporal con reintentos.
   */
  async testConnection(opts: {
    host?: string;
    port?: number | string;
    secure?: boolean;
    user?: string;
    pass?: string;
    fromName?: string;
    testTo?: string;
  } = {}): Promise<{ success: boolean; message: string; code?: string }> {
    const active = this.settings.getSmtpConfig();
    const host = opts.host || active.host;
    const port = Number(opts.port || active.port);
    const secure = opts.secure !== undefined ? opts.secure : active.secure;
    const user = opts.user || active.user;
    const passProvided = !!opts.pass;
    const pass = passProvided ? (opts.pass as string) : active.pass;
    const fromName = opts.fromName || active.fromName || 'Cursos MAAT';
    const testTo = opts.testTo;

    if (!host || !user) {
      return { success: false, message: 'Faltan datos: host y usuario son obligatorios' };
    }

    const testHtml = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px">
      <h2 style="color:#16a34a">✅ Conexión SMTP funcionando</h2>
      <p>Correo de prueba enviado desde el panel de configuración.</p>
      <p style="color:#6b7280;font-size:13px">Servidor: ${host}:${port} (${secure ? 'TLS' : 'STARTTLS'})<br>Usuario: ${user}</p>
      <hr style="border:none;border-top:1px solid #eee;margin:18px 0">
      <small style="color:#9ca3af">MAAT Academy — Sistema de Cursos</small>
    </div>`;

    const sameAsActive =
      host === active.host &&
      port === active.port &&
      secure === active.secure &&
      user === active.user &&
      !passProvided;

    // ── Caso normal: probar la config activa → reusar el pool ya verificado ──
    if (sameAsActive) {
      const ok = await this.verifyConnection();
      if (!ok) {
        return {
          success: false,
          message:
            'No se pudo verificar la conexión activa. Revisa que el servidor SMTP esté disponible.',
        };
      }
      if (testTo) {
        try {
          await this.sendMailNow(testTo, '✅ Prueba de configuración SMTP — MAAT Academy', testHtml);
        } catch (e: any) {
          return { success: false, message: `Conexión OK, pero el envío falló: ${e.message}` };
        }
        return { success: true, message: `Conexión OK y correo de prueba enviado a ${testTo}` };
      }
      return { success: true, message: 'Conexión SMTP verificada correctamente' };
    }

    // ── Config distinta (aún sin guardar): transporter temporal con reintentos ──
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      requireTLS: !secure,
      auth: { user, pass },
      tls: { rejectUnauthorized: false, servername: host },
      name: this.ehloName(user),
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 35_000,
    });

    let lastErr: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await transporter.verify();
        if (testTo) {
          await transporter.sendMail({
            from: `"${fromName}" <${user}>`,
            to: testTo,
            subject: '✅ Prueba de configuración SMTP — MAAT Academy',
            html: testHtml,
          });
        }
        transporter.close();
        return {
          success: true,
          message: testTo
            ? `Conexión OK y correo de prueba enviado a ${testTo}`
            : 'Conexión SMTP verificada correctamente',
        };
      } catch (e: any) {
        lastErr = e;
        const tarpit = /greeting|timeout|ETIMEDOUT/i.test(e.message || '');
        if (tarpit && attempt < 3) {
          // El servidor está limitando conexiones; esperar y reintentar.
          await this.sleep(8000 * attempt);
          continue;
        }
        break;
      }
    }
    transporter.close();

    let hint = '';
    if (lastErr?.code === 'ETIMEDOUT' && secure) {
      hint =
        ' — Sugerencia: el puerto 465 (TLS implícito) suele colgarse en este servidor. Usa el 587 con "STARTTLS".';
    } else if (/greeting/i.test(lastErr?.message || '')) {
      hint =
        ' — Sugerencia: el servidor está limitando conexiones (tarpit). Espera unos segundos y reintenta, o guarda primero la configuración.';
    } else if (/auth|535|credentials/i.test(lastErr?.message || '')) {
      hint = ' — Sugerencia: revisa usuario/contraseña.';
    }
    return {
      success: false,
      message: `Fallo de conexión SMTP: ${lastErr?.message}${hint}`,
      code: lastErr?.code || undefined,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Plantillas existentes (sin cambios de firma)
  // ───────────────────────────────────────────────────────────────────────────
  async sendVerificationEmail(email: string, token: string, nombre: string) {
    const base = (this.settings.get('frontend_url') || '').replace(/\/+$/, '');
    const verificationUrl = `${base}/verify-email?token=${encodeURIComponent(token)}`;
    const esc = (s: string) =>
      String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
    let sitio = base;
    try { sitio = new URL(base).host; } catch { /* usa base tal cual */ }

    // Plantilla sobria (pocas imágenes/emojis, texto explicativo, un solo
    // enlace a nuestro propio dominio): los filtros antispam desconfían de los
    // correos que son solo un botón.
    const html = `
<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Confirma tu correo</title></head>
<body style="margin:0;padding:0;background:#f4f6fb">
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937">
  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:28px">
    <p style="margin:0 0 6px;font-size:13px;color:#6b7280">MAAT Academy &middot; Cursos</p>
    <h1 style="margin:0 0 18px;font-size:20px;color:#111827">Confirma tu correo electrónico</h1>
    <p style="margin:0 0 12px;line-height:1.55">Hola ${esc(nombre)},</p>
    <p style="margin:0 0 12px;line-height:1.55">Gracias por registrarte en la plataforma de cursos de MAAT Academy. Para terminar de crear tu cuenta, confirma que esta dirección de correo es tuya:</p>
    <p style="text-align:center;margin:24px 0">
      <a href="${verificationUrl}" style="background:#1d4ed8;color:#ffffff;padding:12px 28px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold">Confirmar mi correo</a>
    </p>
    <p style="margin:0 0 12px;line-height:1.55;font-size:14px;color:#4b5563">Si el botón no funciona, copia y pega este enlace en tu navegador:<br><span style="word-break:break-all;color:#1d4ed8">${verificationUrl}</span></p>
    <p style="margin:0;line-height:1.55;font-size:14px;color:#4b5563">El enlace es válido durante 24 horas. Si caduca, puedes pedir uno nuevo desde la pantalla de inicio de sesión.</p>
  </div>
  <p style="margin:16px 4px 0;font-size:12px;line-height:1.5;color:#6b7280">Recibes este mensaje porque se creó una cuenta con esta dirección en ${esc(sitio)}. Si no fuiste tú, ignora este correo: la cuenta no se activará.</p>
  <p style="margin:6px 4px 0;font-size:12px;color:#6b7280">MAAT Academy</p>
</div>
</body></html>`.trim();

    await this.sendMail(email, 'Confirma tu correo - MAAT Academy', html, undefined, { priority: true });
  }

  async sendDiploma(
    email: string,
    tituloCurso: string,
    diplomaHtml: string,
    nombre: string,
  ): Promise<void> {
    const subject = `🎓 Tu Diploma de Asistencia – ${tituloCurso} | MAAT Academy`;
    await this.sendMail(email, subject, diplomaHtml);
  }
}
