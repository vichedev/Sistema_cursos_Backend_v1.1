// src/settings/settings.controller.ts
import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { SettingsService, AI_PROVIDERS } from './settings.service';
import { MailService } from '../common/mail.service';
import { AIService } from '../common/ai.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';

@Controller('settings')
@Roles('ADMIN')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(
    private settings: SettingsService,
    private mail: MailService,
    private ai: AIService,
  ) {}

  /** PÚBLICO: datos de contacto que muestra la landing. */
  @Public()
  @Get('contact')
  getContact() {
    return { success: true, data: this.settings.getContactConfig() };
  }

  /**
   * PÚBLICO: recibe un mensaje del formulario de contacto de la landing y lo
   * envía por correo al destino configurado. Incluye confirmación al remitente.
   */
  @Public()
  @Post('contact')
  async submitContact(@Body() body: any) {
    const nombre = String(body?.nombre || '').trim().slice(0, 120);
    const correo = String(body?.correo || '').trim().slice(0, 160);
    const mensaje = String(body?.mensaje || '').trim().slice(0, 5000);

    if (!nombre || !correo || !mensaje) {
      throw new BadRequestException('Completa nombre, correo y mensaje');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
      throw new BadRequestException('El correo no es válido');
    }

    const destino = this.settings.getContactDestino();
    if (!destino) {
      throw new BadRequestException('No hay un correo de contacto configurado. Inténtalo más tarde.');
    }

    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const mensajeHtml = esc(mensaje).replace(/\n/g, '<br>');

    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:linear-gradient(135deg,#2563eb,#7c3aed);padding:20px 24px;border-radius:14px 14px 0 0">
    <h2 style="color:#fff;margin:0">📨 Nuevo mensaje de contacto</h2>
  </div>
  <div style="border:1px solid #eee;border-top:none;border-radius:0 0 14px 14px;padding:24px">
    <p><b>Nombre:</b> ${esc(nombre)}</p>
    <p><b>Correo:</b> <a href="mailto:${esc(correo)}">${esc(correo)}</a></p>
    <p><b>Mensaje:</b></p>
    <div style="background:#f8fafc;border-left:3px solid #2563eb;padding:12px 16px;border-radius:6px;line-height:1.6">${mensajeHtml}</div>
    <p style="color:#9ca3af;font-size:12px;margin-top:20px">Enviado desde el formulario de contacto de MAAT Academy.</p>
  </div>
</div>`.trim();

    try {
      await this.mail.sendMail(destino, `Contacto web: ${nombre}`, html);
    } catch (e: any) {
      this.logger.error(`No se pudo enviar el mensaje de contacto: ${e.message}`);
      throw new BadRequestException('No se pudo enviar el mensaje en este momento. Inténtalo más tarde.');
    }

    // Confirmación al remitente (best-effort, no bloquea la respuesta).
    const confirmHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2937">
  <div style="background:linear-gradient(135deg,#2563eb,#7c3aed);padding:20px 24px;border-radius:14px 14px 0 0">
    <h2 style="color:#fff;margin:0">¡Gracias por escribirnos, ${esc(nombre)}!</h2>
  </div>
  <div style="border:1px solid #eee;border-top:none;border-radius:0 0 14px 14px;padding:24px;line-height:1.6">
    <p>Hemos recibido tu mensaje y nuestro equipo te responderá en menos de 24 horas.</p>
    <p style="color:#6b7280"><b>Tu mensaje:</b><br>${mensajeHtml}</p>
    <p style="margin-top:16px">— Equipo de MAAT Academy</p>
  </div>
</div>`.trim();
    this.mail
      .sendMail(correo, 'Hemos recibido tu mensaje — MAAT Academy', confirmHtml)
      .catch((e) => this.logger.warn(`No se pudo enviar confirmación a ${correo}: ${e.message}`));

    return { success: true, message: 'Mensaje enviado correctamente' };
  }

  /** Devuelve toda la configuración (secretos enmascarados) + metadatos. */
  @Get()
  async getAll() {
    return {
      success: true,
      data: this.settings.getAllForAdmin(),
      aiProviders: AI_PROVIDERS,
    };
  }

  /** Prueba la conexión con el proveedor de IA configurado. */
  @Post('test-ai')
  async testAi() {
    return this.ai.testConnection();
  }

  /** Guarda cambios de configuración. */
  @Put()
  async update(@Body() body: Record<string, any>) {
    await this.settings.setMany(body || {});
    return {
      success: true,
      message: 'Configuración guardada correctamente',
      data: this.settings.getAllForAdmin(),
    };
  }

  /**
   * Prueba la conexión SMTP. Usa los valores enviados en el body (para probar
   * ANTES de guardar) o, si vienen vacíos, los ya almacenados. Si se envía
   * `testTo`, además manda un correo de prueba real.
   */
  @Post('test-smtp')
  async testSmtp(@Body() body: any) {
    const secure =
      body?.smtp_secure !== undefined
        ? body.smtp_secure === true || body.smtp_secure === 'true'
        : undefined;
    const result = await this.mail.testConnection({
      host: body?.smtp_host || undefined,
      port: body?.smtp_port || undefined,
      secure,
      user: body?.smtp_user || undefined,
      pass: body?.smtp_pass || undefined,
      fromName: body?.smtp_from_name || undefined,
      testTo: body?.testTo || undefined,
    });
    if (!result.success) {
      this.logger.warn(`Prueba SMTP fallida: ${result.message}`);
    }
    return result;
  }
}
