// src/evaluations/evaluacion-respuesta.entity.ts
import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique, UpdateDateColumn,
} from 'typeorm';
import { EvaluacionIntento, numericTransformer } from './evaluacion-intento.entity';

@Entity('evaluacion_respuestas')
@Unique(['intentoId', 'preguntaId'])
export class EvaluacionRespuesta {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => EvaluacionIntento, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'intentoId' })
  intento: EvaluacionIntento;

  @Column()
  intentoId: number;

  @Column({ type: 'int' })
  preguntaId: number;

  /** Ids de las opciones elegidas (number[]). */
  @Column({ type: 'simple-json' })
  opcionIds: number[];

  /** Se rellena al calificar (solo servidor). null mientras el intento está EN_CURSO. */
  @Column({ type: 'boolean', nullable: true })
  correcta: boolean | null;

  @Column({ type: 'numeric', precision: 8, scale: 2, nullable: true, transformer: numericTransformer })
  puntos: number | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
