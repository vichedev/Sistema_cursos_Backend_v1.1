// src/evaluations/evaluations.cron.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EvaluationsService } from './evaluations.service';

@Injectable()
export class EvaluationsCron {
  private readonly logger = new Logger(EvaluationsCron.name);
  private ejecutando = false;

  constructor(private readonly evaluations: EvaluationsService) {}

  /**
   * Cada minuto: finaliza y califica los intentos EN_CURSO cuyo tiempo
   * (+ margen de gracia) ya venció, aunque el estudiante haya cerrado la página.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async finalizarIntentosVencidos() {
    if (this.ejecutando) return; // evita solapamientos si una pasada tarda más de 1 min
    this.ejecutando = true;
    try {
      const n = await this.evaluations.finalizarVencidos();
      if (n > 0) this.logger.log(`⏰ Cron: ${n} intento(s) de evaluación vencido(s) finalizado(s) y calificado(s)`);
    } catch (e: any) {
      this.logger.error(`❌ Cron: error finalizando intentos vencidos: ${e?.message}`);
    } finally {
      this.ejecutando = false;
    }
  }
}
