// src/common/tasks.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CouponsService } from '../coupons/coupons.service';
import { User } from '../users/user.entity';

// Días sin verificar tras los que se elimina lógicamente la cuenta
const DIAS_PARA_ELIMINAR_SIN_VERIFICAR = 7;

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly couponsService: CouponsService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

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

  // Elimina lógicamente (activo=false) los estudiantes que llevan más de
  // DIAS_PARA_ELIMINAR_SIN_VERIFICAR días sin verificar su correo.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgarNoVerificados() {
    this.logger.log('⏰ Cron: Revisando cuentas sin verificar...');
    try {
      const cutoff = new Date(
        Date.now() - DIAS_PARA_ELIMINAR_SIN_VERIFICAR * 24 * 60 * 60 * 1000,
      );
      const result = await this.userRepo
        .createQueryBuilder()
        .update(User)
        .set({ activo: false })
        .where('rol = :rol', { rol: 'ESTUDIANTE' })
        .andWhere('"emailVerified" = false')
        .andWhere('activo = true')
        .andWhere('"emailVerificationSentAt" IS NOT NULL')
        .andWhere('"emailVerificationSentAt" < :cutoff', { cutoff })
        .execute();

      const n = result.affected || 0;
      if (n > 0) {
        this.logger.log(
          `🗑️ Cron: ${n} cuenta(s) sin verificar eliminadas lógicamente (>${DIAS_PARA_ELIMINAR_SIN_VERIFICAR} días)`,
        );
      } else {
        this.logger.log('✅ Cron: No hay cuentas sin verificar para eliminar');
      }
    } catch (error) {
      this.logger.error('❌ Cron: Error purgando no verificados:', error.message);
    }
  }
}
