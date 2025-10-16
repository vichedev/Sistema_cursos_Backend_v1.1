import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;

  constructor(private config: ConfigService) {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    const config = {
      host: this.config.get('SMTP_HOST'),
      port: Number(this.config.get('SMTP_PORT')),
      secure: this.config.get('SMTP_SECURE') === 'true',
      auth: {
        user: this.config.get('SMTP_USER'),
        pass: this.config.get('SMTP_PASS'),
      },
      // CONFIGURACIÓN MÍNIMA PARA DIAGNÓSTICO
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    };

    console.log('🔧 Configuración SMTP:', {
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.auth.user,
      hasPassword: !!config.auth.pass
    });

    this.transporter = nodemailer.createTransport(config);

    // VERIFICAR CONEXIÓN CON MÁS DETALLES
    this.verifyConnection();
  }

  private async verifyConnection() {
    try {
      console.log('🔌 Intentando conectar con SMTP...');
      await this.transporter.verify();
      console.log('✅ Conexión SMTP exitosa');
    } catch (error) {
      console.error('❌ Error de conexión SMTP:', {
        message: error.message,
        code: error.code,
        command: error.command
      });
      
      // INTENTAR CON CONFIGURACIONES ALTERNATIVAS
      await this.tryAlternativeConfigs();
    }
  }

  private async tryAlternativeConfigs() {
    const alternatives = [
      { port: 465, secure: true, name: 'Puerto 465 (SSL)' },
      { port: 25, secure: false, name: 'Puerto 25' },
      { port: 587, secure: false, name: 'Puerto 587 (TLS)' },
    ];

    for (const alt of alternatives) {
      try {
        console.log(`🔄 Probando ${alt.name}...`);
        
        const testTransporter = nodemailer.createTransport({
          host: this.config.get('SMTP_HOST'),
          port: alt.port,
          secure: alt.secure,
          auth: {
            user: this.config.get('SMTP_USER'),
            pass: this.config.get('SMTP_PASS'),
          },
          connectionTimeout: 5000,
          greetingTimeout: 5000,
        });

        await testTransporter.verify();
        console.log(`✅ ${alt.name} FUNCIONA! Usa esta configuración:`);
        console.log(`   SMTP_PORT=${alt.port}`);
        console.log(`   SMTP_SECURE=${alt.secure}`);
        return;
        
      } catch (error) {
        console.log(`❌ ${alt.name} falló: ${error.message}`);
      }
    }
    
    console.error('🚫 Todas las configuraciones alternativas fallaron');
  }

  async sendMail(to: string, subject: string, html: string) {
    const startTime = Date.now();
    
    const mailOptions = {
      from: `"Cursos MAAT" <${this.config.get('SMTP_USER')}>`,
      to,
      subject,
      html,
      // ✅ HEADERS PARA ENTREGA RÁPIDA
      headers: {
        'X-Priority': '1',
        'X-MSMail-Priority': 'High',
        'Importance': 'high',
        'Precedence': 'bulk'
      }
    };

    try {
      console.log(`📤 Enviando correo a: ${to}`);
      
      const result = await this.transporter.sendMail(mailOptions);
      const duration = Date.now() - startTime;
      
      console.log(`✅ Correo enviado en ${duration}ms a: ${to}`);
      return result;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Error en ${duration}ms enviando a ${to}:`, error.message);
      throw error;
    }
  }

  // ✅ MÉTODO OPTIMIZADO - HTML MÁS SIMPLE Y RÁPIDO
  async sendVerificationEmail(email: string, token: string, nombre: string) {
    const verificationUrl = `${this.config.get('FRONTEND_URL')}/verify-email?token=${token}`;

    // ✅ HTML SUPER OPTIMIZADO - MENOS BYTES, MÁS RÁPIDO
    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <h2 style="color:#2563eb;margin-bottom:20px">Activa tu cuenta - Cursos MAAT</h2>
  <p>Hola <strong>${nombre}</strong>,</p>
  <p>Para activar tu cuenta, haz clic en el botón:</p>
  <div style="text-align:center;margin:25px 0">
    <a href="${verificationUrl}" style="background:#2563eb;color:white;padding:12px 30px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold">Activar Cuenta</a>
  </div>
  <p style="color:#6b7280;font-size:14px">Si no funciona, copia: ${verificationUrl}</p>
  <hr style="margin:25px 0">
  <p style="color:#9ca3af;font-size:12px">Cursos MAAT</p>
</div>
    `.trim(); // ✅ trim() elimina espacios innecesarios

    await this.sendMail(email, 'Activa tu cuenta - Cursos MAAT', html);
  }

}