import { Injectable, Logger } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * Wrapper de compatibilidad. La lógica de cola/throttle/reintentos ahora vive
 * dentro de MailService (cola secuencial global anti-baneo), así que aquí solo
 * delegamos. Se mantiene la firma `addToQueue` para no tocar auth.service.
 */
@Injectable()
export class MailQueueService {
  private readonly logger = new Logger(MailQueueService.name);

  constructor(private mailService: MailService) {}

  addToQueue(email: string, token: string, nombre: string) {
    this.mailService
      .sendVerificationEmail(email, token, nombre)
      .catch((e) => this.logger.error(`❌ Error enviando verificación a ${email}: ${e.message}`));
  }

  getQueueStatus() {
    return this.mailService.getQueueStatus();
  }
}
