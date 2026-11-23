// src/app.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { join } from 'path';
import { ENTITIES } from './database/entities';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CategoriesModule } from './categories/categories.module';
import { CoursesModule } from './courses/courses.module';
import { PaymentsModule } from './payments/payments.module';
import { StatsModule } from './stats/stats.module';
import { CommonModule } from './common/common.module';
import { NotificationsModule } from './notifications/notifications.module';
import { CouponsModule } from './coupons/coupons.module';
// ✅ NUEVO: módulo de diplomas
import { DiplomasModule } from './diplomas/diplomas.module';
// ✅ NUEVO: configuración, WhatsApp nativo y campañas/publicidad
import { SettingsModule } from './settings/settings.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { CampaignsModule } from './campaigns/campaigns.module';
// ✅ NUEVO: evaluaciones de diagnóstico
import { EvaluationsModule } from './evaluations/evaluations.module';

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
        entities: ENTITIES,
        // VULN-01: synchronize solo en desarrollo — en producción se usan migraciones.
        synchronize: config.get('NODE_ENV') !== 'production',
        // Las migraciones pendientes (src/database/migrations) se aplican solas al
        // arrancar, en una transacción por migración. Así producción ya no
        // depende de ejecutar SQL a mano.
        // La app siempre corre compilada (dist): solo .js, nunca los .d.ts.
        migrations: [join(__dirname, 'database', 'migrations', '*.js')],
        migrationsTableName: 'migrations',
        migrationsRun: true,
        migrationsTransactionMode: 'each',
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 600 }]),
    // ✅ Configuración global (debe ir antes de CommonModule: MailService la consume)
    SettingsModule,
    WhatsappModule,
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
    // ✅ NUEVO: campañas / publicidad
    CampaignsModule,
    // ✅ NUEVO: categorías de cursos
    CategoriesModule,
    // ✅ NUEVO: evaluaciones de diagnóstico (cursos privados / asignados)
    EvaluationsModule,
  ],
})
export class AppModule { }