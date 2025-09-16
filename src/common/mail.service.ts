import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;

  constructor(private config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: config.get('SMTP_HOST'),
      port: Number(config.get('SMTP_PORT')),
      secure: config.get('SMTP_SECURE') === 'true',
      auth: {
        user: config.get('SMTP_USER'),
        pass: config.get('SMTP_PASS'),
      },
    });
  }

  async sendMail(to: string, subject: string, html: string) {
    await this.transporter.sendMail({
      from: `"Cursos RNC" <${this.config.get('SMTP_USER')}>`,
      to,
      subject,
      html,
    });
  }

  // Método para enviar correo de verificación
  async sendVerificationEmail(email: string, token: string, nombre: string) {
    const verificationUrl = `${this.config.get('FRONTEND_URL')}/verify-email?token=${token}`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Verificación de correo - Cursos RNC</h2>
        <p>Hola ${nombre},</p>
        <p>Gracias por registrarte en nuestra plataforma. Para completar tu registro, por favor verifica tu dirección de correo electrónico haciendo clic en el siguiente botón:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" 
             style="background-color: #ff6b00; color: white; padding: 12px 24px; 
                    text-decoration: none; border-radius: 5px; display: inline-block;
                    font-weight: bold;">
            Verificar correo electrónico
          </a>
        </div>
        <p>Si no puedes hacer clic en el botón, copia y pega la siguiente URL en tu navegador:</p>
        <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
        <p>Si no solicitaste esta verificación, puedes ignorar este correo.</p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px;">
          Este correo fue enviado automáticamente por el Sistema de Cursos RNC.
        </p>
      </div>
    `;

    await this.sendMail(email, 'Verifica tu correo electrónico', html);
  }
}