// src/courses/course.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { StudentCourse } from './student-course.entity';
import { User } from '../users/user.entity';
import { Coupon } from '../coupons/coupon.entity'; // ✅ AGREGAR ESTA IMPORT

export type TipoCurso = 'ONLINE_GRATIS' | 'ONLINE_PAGADO' | 'PRESENCIAL_GRATIS' | 'PRESENCIAL_PAGADO';

@Entity('cursos')
export class Course {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  titulo: string;

  @Column()
  descripcion: string;

  @Column({ nullable: true })
  imagen: string;

  @Column()
  tipo: TipoCurso;

  @Column({ default: 0 })
  cupos: number;

  @Column({ nullable: true })
  link: string;

  // ✅ NUEVO CAMPO: Link de recursos del curso
  @Column({ nullable: true })
  recursosLink: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  precio: number;

  @Column({ type: 'date', nullable: true })
  fecha: string;

  @Column({ type: 'time', nullable: true })
  hora: string;

  /** Zona horaria de referencia del curso (IANA), ej: America/Guayaquil. */
  @Column({ default: 'America/Guayaquil' })
  zonaHoraria: string;

  // Relación ManyToOne hacia User (profesor) - AGREGAR onDelete
  @ManyToOne(() => User, (user) => user.cursosDictados, {
    nullable: true,
    onDelete: 'SET NULL'
  })
  @JoinColumn({ name: 'profesorId' })
  profesor: User;

  @Column({ nullable: true })
  profesorId: number;

  @Column({ default: true })
  activo: boolean;

  /** Finalizado MANUALMENTE por el administrador (no por fecha). */
  @Column({ default: false })
  finalizado: boolean;

  /** Categoría del curso (MikroTik, Redes, Seguridad, etc.). */
  @Column({ type: 'int', nullable: true })
  categoriaId: number | null;

  @OneToMany(() => StudentCourse, (studentCourse) => studentCourse.curso)
  studentCourses: StudentCourse[];

  // ✅ AGREGAR RELACIÓN CON CUPONES
  @OneToMany(() => Coupon, (coupon) => coupon.curso)
  cupones: Coupon[];

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}