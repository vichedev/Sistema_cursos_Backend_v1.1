// src/evaluations/evaluacion-pregunta.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Evaluacion } from './evaluacion.entity';

export type TipoPregunta = 'UNICA' | 'MULTIPLE' | 'VF';

@Entity('evaluacion_preguntas')
export class EvaluacionPregunta {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Evaluacion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'evaluacionId' })
  evaluacion: Evaluacion;

  @Index()
  @Column()
  evaluacionId: number;

  @Column({ type: 'text' })
  enunciado: string;

  @Column({ type: 'varchar' })
  tipo: TipoPregunta;

  @Column({ type: 'int', default: 1 })
  puntos: number;

  @Column({ type: 'int' })
  orden: number;
}
