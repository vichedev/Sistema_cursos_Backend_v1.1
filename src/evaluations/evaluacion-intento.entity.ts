// src/evaluations/evaluacion-intento.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique, Index } from 'typeorm';
import { Evaluacion } from './evaluacion.entity';
import { User } from '../users/user.entity';

export type EstadoIntento = 'EN_CURSO' | 'ENVIADO' | 'EXPIRADO';

/** Orden (ya barajado) de preguntas y opciones con el que se presenta el intento. */
export interface OrdenIntento {
  preguntas: Array<{ id: number; opciones: number[] }>;
}

/** numeric de Postgres llega como string → se expone como number. */
export const numericTransformer = {
  to: (v: number | null | undefined) => v,
  from: (v: string | null) => (v === null || v === undefined ? null : Number(v)),
};

@Entity('evaluacion_intentos')
@Unique(['evaluacionId', 'estudianteId', 'numero'])
export class EvaluacionIntento {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Evaluacion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'evaluacionId' })
  evaluacion: Evaluacion;

  @Column()
  evaluacionId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'estudianteId' })
  estudiante: User;

  @Index()
  @Column()
  estudianteId: number;

  /** Número de intento del estudiante en esta evaluación (1, 2, ...). */
  @Column({ type: 'int' })
  numero: number;

  @Column({ type: 'varchar' })
  estado: EstadoIntento;

  @Column({ type: 'timestamp' })
  iniciadoEn: Date;

  /** Fijado por el SERVIDOR al iniciar. El cliente nunca decide el tiempo. */
  @Column({ type: 'timestamp' })
  expiraEn: Date;

  @Column({ type: 'timestamp', nullable: true })
  enviadoEn: Date | null;

  @Column({ type: 'numeric', precision: 8, scale: 2, nullable: true, transformer: numericTransformer })
  puntaje: number | null;

  @Column({ type: 'numeric', precision: 8, scale: 2, transformer: numericTransformer })
  puntajeMax: number;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: numericTransformer })
  porcentaje: number | null;

  @Column({ type: 'simple-json' })
  orden: OrdenIntento;
}
