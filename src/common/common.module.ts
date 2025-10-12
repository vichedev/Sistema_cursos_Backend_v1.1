// src/common/common.module.ts
import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailService } from './mail.service';
import { AIService } from './ai.service';


@Global() // ✅ HACER MÓDULO GLOBAL
@Module({
  imports: [ConfigModule],
  providers: [MailService, AIService, ], // ✅ AGREGAR SanitizeInterceptor
  exports: [MailService, AIService, ], // ✅ AGREGAR SanitizeInterceptor
})
export class CommonModule {}