// src/payments/payments.module.ts
import { Module } from '@nestjs/common';
import { PayphoneService } from './payphone.service';
import { PaymentsController } from './payments.controller';
import { MailService } from '../common/mail.service';
import { CoursesModule } from '../courses/courses.module';
import { UsersModule } from '../users/users.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudentCourse } from '../courses/student-course.entity';
import { PaymentAttempt } from './payment-attempt.entity';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    CoursesModule,
    UsersModule,
    HttpModule,
    TypeOrmModule.forFeature([StudentCourse, PaymentAttempt])
  ],
  controllers: [PaymentsController],
  providers: [PayphoneService, MailService],
})
export class PaymentsModule { }