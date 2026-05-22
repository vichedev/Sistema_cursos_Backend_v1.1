// src/payments/payments.module.ts
import { Module } from '@nestjs/common';
import { PayphoneService } from './payphone.service';
import { PaymentsController } from './payments.controller';
import { CoursesModule } from '../courses/courses.module';
import { UsersModule } from '../users/users.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudentCourse } from '../courses/student-course.entity';
import { PaymentAttempt } from './payment-attempt.entity';
import { HttpModule } from '@nestjs/axios';
// ✅ AGREGAR IMPORT
import { CouponsModule } from '../coupons/coupons.module';
import { CouponUsage } from '../coupons/coupon-usage.entity'; // ✅ AGREGAR ESTE IMPORT

@Module({
  imports: [
    CoursesModule,
    UsersModule,
    HttpModule,
    // ✅ AGREGAR COUPONS MODULE
    CouponsModule,
    TypeOrmModule.forFeature([
      StudentCourse, 
      PaymentAttempt,
      CouponUsage // ✅ AGREGAR ESTA ENTIDAD
    ])
  ],
  controllers: [PaymentsController],
  // MailService viene de CommonModule (@Global) — no se declara aquí para
  // evitar una segunda instancia con su propio pool/cola SMTP.
  providers: [PayphoneService],
})
export class PaymentsModule { }