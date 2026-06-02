// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './roles.guard';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CommonModule } from '../common/common.module';
import { User } from '../users/user.entity';
import { AccessLog } from './access-log.entity';

@Module({
  imports: [
    UsersModule,
    ConfigModule,
    CommonModule,
    TypeOrmModule.forFeature([User, AccessLog]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        // ✅ Access token: 15 minutos (antes era 7 días sin expiración)
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN') || '15m' },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy, RolesGuard],
  controllers: [AuthController],
  exports: [JwtStrategy],
})
export class AuthModule { }