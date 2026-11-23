// src/evaluations/evaluacion-opcion.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { EvaluacionPregunta } from './evaluacion-pregunta.entity';

@Entity('evaluacion_opciones')
export class EvaluacionOpcion {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => EvaluacionPregunta, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'preguntaId' })
  pregunta: EvaluacionPregunta;

  @Index()
  @Column()
  preguntaId: number;

  @Column({ type: 'text' })
  texto: string;

  /** SEGURIDAD: este campo JAMÁS se envía en respuestas a estudiantes. */
  @Column({ default: false })
  esCorrecta: boolean;

  @Column({ type: 'int' })
  orden: number;
}
