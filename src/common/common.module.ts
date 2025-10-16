// src/common/common.module.ts
import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailService } from './mail.service';
import { MailQueueService } from './mail-queue.service'; // ✅ AGREGAR ESTE IMPORT
import { AIService } from './ai.service';

@Global() // ✅ MÓDULO GLOBAL
@Module({
  imports: [ConfigModule],
  providers: [
    MailService, 
    MailQueueService, // ✅ AGREGAR AQUÍ
    AIService, 
  ],
  exports: [
    MailService, 
    MailQueueService, // ✅ AGREGAR AQUÍ TAMBIÉN
    AIService, 
  ],
})
export class CommonModule {}