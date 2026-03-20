// src/courses/student-course.entity.ts
import {
  Entity, PrimaryGeneratedColumn, Column,
  ManyToOne, JoinColumn, CreateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Course } from './course.entity';

@Entity('student_courses')
export class StudentCourse {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, user => user.studentCourses, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'estudianteId' })
  estudiante: User;

  @Column()
  estudianteId: number;

  @ManyToOne(() => Course, course => course.studentCourses, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'cursoId' })
  curso: Course;

  @Column()
  cursoId: number;

  @Column({ default: false })
  pagado: boolean;

  // ✅ NUEVO: código único del diploma (se genera al enviar)
  // Formato: MAAT-0001-000001-XXXXXXX
  @Column({ type: 'varchar', nullable: true, unique: true, default: null })
  diplomaCodigo: string;

  // ✅ NUEVO: fecha en que se emitió el diploma
  @Column({ type: 'timestamp', nullable: true, default: null })
  diplomaEmitidoEn: Date;

  @CreateDateColumn()
  createdAt: Date;
}