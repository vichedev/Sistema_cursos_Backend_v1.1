// src/common/common.module.ts
import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailService } from './mail.service';
import { MailQueueService } from './mail-queue.service';
import { AIService } from './ai.service';
import { TasksService } from './tasks.service';
import { CouponsModule } from '../coupons/coupons.module';

@Global()
@Module({
  imports: [ConfigModule, CouponsModule],
  providers: [
    MailService,
    MailQueueService,
    AIService,
    TasksService,
  ],
  exports: [
    MailService,
    MailQueueService,
    AIService,
  ],
})
export class CommonModule {}