// src/app.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { User } from './users/user.entity';
import { Course } from './courses/course.entity';
import { StudentCourse } from './courses/student-course.entity';
import { PaymentAttempt } from './payments/payment-attempt.entity';
import { CoursesModule } from './courses/courses.module';
import { PaymentsModule } from './payments/payments.module';
import { StatsModule } from './stats/stats.module';
import { CommonModule } from './common/common.module';
import { NotificationsModule } from './notifications/notifications.module';
import { Coupon } from './coupons/coupon.entity';
import { CouponUsage } from './coupons/coupon-usage.entity';
import { CouponsModule } from './coupons/coupons.module';
// ✅ NUEVO: módulo de diplomas
import { DiplomasModule } from './diplomas/diplomas.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST'),
        port: Number(config.get('DB_PORT')),
        username: config.get('DB_USER'),
        password: config.get('DB_PASS'),
        database: config.get('DB_NAME'),
        entities: [User, Course, StudentCourse, PaymentAttempt, Coupon, CouponUsage],
        // VULN-01: synchronize solo en desarrollo — en producción usar migraciones
        synchronize: config.get('NODE_ENV') !== 'production',
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 600 }]),
    CommonModule,
    AuthModule,
    UsersModule,
    CoursesModule,
    PaymentsModule,
    StatsModule,
    NotificationsModule,
    CouponsModule,
    // ✅ NUEVO
    DiplomasModule,
  ],
})
export class AppModule { }