import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private config: ConfigService) {
    this.logger.log(`📧 SMTP: ${this.config.get('SMTP_HOST')}:587 | usuario: ${this.config.get('SMTP_USER')}`);
    // Verificar conexión al arrancar sin bloquear el servidor
    this.buildTransporter().verify()
      .then(() => this.logger.log('✅ Conexión SMTP verificada correctamente'))
      .catch((e) => this.logger.warn(`⚠️  SMTP no disponible al arrancar: ${e.message}`));
  }

  // ================================================================
  // ✅ Crea un transporter FRESCO por cada correo
  //    Sin pool, con TLS permisivo — compatible con cPanel/Plesk
  // ================================================================
  private buildTransporter() {
    return nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: 587,
      secure: false,
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
      // ✅ CLAVE: permite certificados autofirmados (común en cPanel)
      tls: {
        rejectUnauthorized: false,
        ciphers: 'SSLv3',
      },
      connectionTimeout: 30000,
      greetingTimeout: 30000,
      socketTimeout: 60000,
      // ❌ Sin pool — conexión nueva y limpia por cada envío
      pool: false,
    });
  }

  // ================================================================
  // ✅ ENVÍO CON RETRY — 3 intentos, 5s entre cada uno
  // ================================================================
  async sendMail(to: string, subject: string, html: string): Promise<void> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 5000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const transporter = this.buildTransporter();
      try {
        const t0 = Date.now();

        await transporter.sendMail({
          from: `"Cursos MAAT" <${this.config.get('SMTP_USER')}>`,
          to,
          subject,
          html,
          headers: {
            'X-Priority': '1',
            'X-MSMail-Priority': 'High',
            'Importance': 'high',
          },
        });

        this.logger.log(`✅ Correo enviado a ${to} en ${Date.now() - t0}ms (intento ${attempt})`);
        transporter.close();
        return; // ← éxito

      } catch (error) {
        transporter.close();
        this.logger.warn(`⚠️  Intento ${attempt}/${MAX_RETRIES} fallido para ${to}: ${error.message}`);

        if (attempt < MAX_RETRIES) {
          this.logger.log(`⏳ Reintentando en ${RETRY_DELAY / 1000}s...`);
          await new Promise(r => setTimeout(r, RETRY_DELAY));
        } else {
          this.logger.error(`❌ No se pudo enviar a ${to} tras ${MAX_RETRIES} intentos`);
          throw new Error(`Fallo al enviar correo a ${to}: ${error.message}`);
        }
      }
    }
  }

  // ================================================================
  // ✅ CORREO DE VERIFICACIÓN DE CUENTA
  // ================================================================
  async sendVerificationEmail(email: string, token: string, nombre: string) {
    const verificationUrl = `${this.config.get('FRONTEND_URL')}/verify-email?token=${token}`;

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
}