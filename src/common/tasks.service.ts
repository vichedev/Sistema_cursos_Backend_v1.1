// src/common/tasks.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CouponsService } from '../coupons/coupons.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(private readonly couponsService: CouponsService) {}

  // MEJ-02: Limpiar reservas de cupones expiradas automáticamente cada hora
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredCouponReservations() {
    this.logger.log('⏰ Cron: Limpiando reservas de cupones expiradas...');
    try {
      await this.couponsService.cleanupExpiredReservations();
      this.logger.log('✅ Cron: Limpieza de cupones completada');
    } catch (error) {
      this.logger.error('❌ Cron: Error limpiando cupones:', error.message);
    }
  }
}
