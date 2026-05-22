// src/whatsapp/whatsapp.controller.ts
import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('whatsapp')
@Roles('ADMIN')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsappController {
  constructor(private wa: WhatsappService) {}

  /** Estado de la conexión + QR (si está esperando escaneo). */
  @Get('status')
  status() {
    return { success: true, data: this.wa.getStatus() };
  }

  /** Inicia la conexión (genera QR si no hay sesión). */
  @Post('connect')
  async connect() {
    await this.wa.start();
    return { success: true, data: this.wa.getStatus() };
  }

  /** Cierra sesión y borra credenciales. */
  @Post('logout')
  async logout() {
    await this.wa.logout();
    return { success: true, message: 'Sesión de WhatsApp cerrada' };
  }

  /** Envía un mensaje de prueba. */
  @Post('test')
  async test(@Body() body: { number: string; message?: string }) {
    if (!body?.number) {
      return { success: false, message: 'Falta el número de destino' };
    }
    if (!this.wa.getStatus().connected) {
      return { success: false, message: 'WhatsApp no está conectado' };
    }
    try {
      await this.wa.sendText(
        body.number,
        body.message || '✅ Mensaje de prueba desde MAAT Academy. ¡Conexión funcionando!',
      );
      return { success: true, message: `Mensaje de prueba enviado a ${body.number}` };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }
}
