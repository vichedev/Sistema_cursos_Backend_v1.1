// src/settings/settings.controller.ts
import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { SettingsService, AI_PROVIDERS } from './settings.service';
import { MailService } from '../common/mail.service';
import { AIService } from '../common/ai.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

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
