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
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ to, subject, html, attachments, resolve, reject, attempts: 0 });
      void this.processQueue();
    });
  }

  getQueueStatus() {
    return { queueLength: this.queue.length, working: this.working };
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
            this.queue.push(item); // al final de la cola
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
      attachments,
      headers: {
        'X-Priority': '3',
        Importance: 'normal',
      },
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
    const verificationUrl = `${this.settings.get('frontend_url')}/verify-email?token=${token}`;

    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <h2 style="color:#2563eb;margin-bottom:20px">Activa tu cuenta - Cursos MAAT</h2>
  <p>Hola <strong>${nombre}</strong>,</p>
  <p>Para activar tu cuenta, haz clic en el botón:</p>
  <div style="text-align:center;margin:25px 0">
    <a href="${verificationUrl}"
       style="background:#2563eb;color:white;padding:12px 30px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold">
      Activar Cuenta
    </a>
  </div>
  <p style="color:#6b7280;font-size:14px">Si el botón no funciona, copia este enlace:<br>${verificationUrl}</p>
  <hr style="margin:25px 0">
  <p style="color:#9ca3af;font-size:12px">Cursos MAAT</p>
</div>`.trim();

    await this.sendMail(email, 'Activa tu cuenta - Cursos MAAT', html);
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
