// src/users/user.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { StudentCourse } from '../courses/student-course.entity';
import { Course } from '../courses/course.entity';

export type Rol = 'ADMIN' | 'ESTUDIANTE';

@Entity('usuarios')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  nombres: string;

  @Column()
  apellidos: string;

  @Column({ unique: true })
  correo: string;

  @Column({ unique: true })
  usuario: string;

  @Column({ unique: true })
  cedula: string;

  @Column()
  celular: string;

  @Column()
  password: string;

  @Column({ default: 'ESTUDIANTE' })
  rol: Rol;

  @Column({ nullable: true })
  ciudad: string;

  @Column({ nullable: true })
  empresa?: string;

  @Column({ nullable: true })
  cargo: string;

  @Column({ nullable: true })
  asignatura?: string;

  // Campos para verificación de correo
  @Column({ default: false })
  emailVerified: boolean;

  @Column({ type: 'varchar', nullable: true })
  emailVerificationToken?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  emailVerificationSentAt?: Date | null;

  // ✅ NUEVO CAMPO PARA SOFT DELETE
  @Column({ default: true })
  activo: boolean;

  @OneToMany(() => StudentCourse, (studentCourse) => studentCourse.estudiante)
  studentCourses: StudentCourse[];

  @OneToMany(() => Course, (course) => course.profesor)
  cursosDictados: Course[];
}