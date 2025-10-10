// src/common/common.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailService } from './mail.service';
import { AIService } from './ai.service'; // ✅ Agregar esta línea

@Module({
  imports: [ConfigModule],
  providers: [MailService, AIService], // ✅ Agregar AIService aquí
  exports: [MailService, AIService], // ✅ Agregar AIService aquí
})
export class CommonModule {}