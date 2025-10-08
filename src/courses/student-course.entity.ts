// src/courses/student-course.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';
import { Course } from './course.entity';

@Entity('student_courses')
export class StudentCourse {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, user => user.studentCourses, { 
    eager: true,
    onDelete: 'CASCADE' // ✅ SOLO ESTA LÍNEA NUEVA
  })
  @JoinColumn({ name: 'estudianteId' })
  estudiante: User;

  @Column()
  estudianteId: number;

  @ManyToOne(() => Course, course => course.studentCourses, { 
    eager: true,
    onDelete: 'CASCADE' // ✅ SOLO ESTA LÍNEA NUEVA  
  })
  @JoinColumn({ name: 'cursoId' })
  curso: Course;

  @Column()
  cursoId: number;

  @Column({ default: false })
  pagado: boolean;

  @CreateDateColumn()
  createdAt: Date;
}