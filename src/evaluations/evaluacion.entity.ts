// src/evaluations/evaluacion.entity.ts
import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';
import { Course } from '../courses/course.entity';

export type EstadoEvaluacion = 'BORRADOR' | 'PUBLICADA' | 'CERRADA';

@Entity('evaluaciones')
export class Evaluacion {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Course, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cursoId' })
  curso: Course;

  @Index()
  @Column()
  cursoId: number;

  @Column()
  titulo: string;

  @Column({ type: 'text', default: '' })
  instrucciones: string;

  @Column({ type: 'varchar', default: 'DIAGNOSTICO' })
  tipo: string;

  /** Duración del intento en minutos (1–300). */
  @Column({ type: 'int' })
  duracionMin: number;

  @Column({ type: 'int', default: 1 })
  intentosMax: number;

  /** Barajar el orden de preguntas y opciones en cada intento. */
  @Column({ default: true })
  aleatorizar: boolean;

  @Column({ type: 'varchar', default: 'BORRADOR' })
  estado: EstadoEvaluacion;

  @Column({ type: 'timestamp', nullable: true })
  disponibleDesde: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  disponibleHasta: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  publicadaEn: Date | null;

  @Column({ type: 'int', nullable: true })
  creadoPor: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
