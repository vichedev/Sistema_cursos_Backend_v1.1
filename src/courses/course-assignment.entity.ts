// src/courses/course-assignment.entity.ts
import {
  Entity, PrimaryGeneratedColumn, Column,
  ManyToOne, JoinColumn, CreateDateColumn, Unique,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Course } from './course.entity';

/**
 * Asignación de un estudiante a un curso PRIVADO.
 * Un curso privado solo lo ven (y solo pueden inscribirse/pagarlo) el admin y
 * los estudiantes que tengan una fila aquí.
 */
@Entity('curso_asignaciones')
@Unique(['cursoId', 'estudianteId'])
export class CourseAssignment {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Course, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cursoId' })
  curso: Course;

  @Column()
  cursoId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'estudianteId' })
  estudiante: User;

  @Column()
  estudianteId: number;

  /** Id del admin que hizo la asignación (informativo, sin FK). */
  @Column({ type: 'int', nullable: true })
  asignadoPor: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
