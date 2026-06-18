// src/common/common.module.ts
import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { MailService } from './mail.service';
import { MailQueueService } from './mail-queue.service';
import { AIService } from './ai.service';
import { TasksService } from './tasks.service';
import { EmailValidatorService } from './email-validator.service';
import { CouponsModule } from '../coupons/coupons.module';

@Global()
@Module({
  imports: [ConfigModule, CouponsModule, TypeOrmModule.forFeature([User])],
  providers: [
    MailService,
    MailQueueService,
    AIService,
    TasksService,
    EmailValidatorService,
  ],
  exports: [
    MailService,
    MailQueueService,
    AIService,
    EmailValidatorService,
  ],
})
export class CommonModule {}