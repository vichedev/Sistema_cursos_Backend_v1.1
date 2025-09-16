// src/app.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { User } from './users/user.entity';
import { Course } from './courses/course.entity';
import { StudentCourse } from './courses/student-course.entity';
import { PaymentAttempt } from './payments/payment-attempt.entity';
import { CoursesModule } from './courses/courses.module';
import { PaymentsModule } from './payments/payments.module';
import { StatsModule } from './stats/stats.module';

import { CommonModule } from './common/common.module'; // <-- agregado

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
        entities: [
          User,
          Course,
          StudentCourse,
          PaymentAttempt,
        ],
        synchronize: true,
      }),
      inject: [ConfigService],
    }),
    CommonModule, // <-- importar CommonModule para proveer MailService
    AuthModule,
    UsersModule,
    CoursesModule,
    PaymentsModule,
    StatsModule,
  ],
})
export class AppModule {}