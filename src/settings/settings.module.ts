// src/settings/settings.module.ts
import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Setting } from './setting.entity';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Setting]), ConfigModule],
  providers: [SettingsService],
  controllers: [SettingsController],
  exports: [SettingsService],
})
export class SettingsModule {}
