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

  // ✅ CELULAR: Guarda formato internacional completo (+593991234567)
  @Column()
  celular: string;

  // ✅ NUEVO: País del usuario (EC, CO, AR, etc.)
  @Column({ nullable: true })
  pais: string;

  // ✅ Foto de perfil (nombre de archivo en /uploads)
  @Column({ type: 'varchar', nullable: true })
  foto: string | null;

  @Column()
  password: string;

  @Column({ default: 'ESTUDIANTE' })
  rol: Rol;

  @Column({ nullable: true })
  ciudad: string;

  @Column({ nullable: true })
  empresa?: string;

  @Column({ nullable: true })
  cargo: string;  // ← "Gerente" o "Técnico"

  @Column({ nullable: true })
  asignatura?: string;

  @Column({ default: false })
  emailVerified: boolean;

  /** Resultado de la validación de existencia del correo: valido | riesgoso | invalido. */
  @Column({ type: 'varchar', nullable: true })
  emailEstado: string | null;

  /** Fecha de la última validación del correo. */
  @Column({ type: 'timestamp', nullable: true })
  emailValidadoEn: Date | null;

  /** Cuenta suspendida: no puede iniciar sesión hasta que soporte la reactive. */
  @Column({ default: false })
  suspendido: boolean;

  /** Motivo de la suspensión (se muestra al usuario al intentar entrar). */
  @Column({ type: 'varchar', nullable: true })
  motivoSuspension: string | null;

  /** Fecha de la suspensión. */
  @Column({ type: 'timestamp', nullable: true })
  suspendidoEn: Date | null;

  @Column({ type: 'varchar', nullable: true })
  emailVerificationToken?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  emailVerificationSentAt?: Date | null;

  @Column({ default: true })
  activo: boolean;

  @OneToMany(() => StudentCourse, (studentCourse) => studentCourse.estudiante)
  studentCourses: StudentCourse[];

  @OneToMany(() => Course, (course) => course.profesor)
  cursosDictados: Course[];

  @Column({ nullable: true, type: 'varchar', length: 64 })
  passwordResetToken: string | null;

  @Column({ nullable: true, type: 'timestamp' })
  passwordResetExpiresAt: Date | null;

}