import { Entity, PrimaryGeneratedColumn, Column, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { StudentCourse } from './student-course.entity';
import { User } from '../users/user.entity';

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

  @Column({ default: 0 })
  precio: number;

  @Column({ type: 'date', nullable: true })
  fecha: string;

  @Column({ type: 'time', nullable: true })
  hora: string;

  // Relación ManyToOne hacia User (profesor)
  @ManyToOne(() => User, (user) => user.cursosDictados, { eager: true, nullable: true })
  @JoinColumn({ name: 'profesorId' })
  profesor: User;

  @Column({ nullable: true })
  profesorId: number;

  @Column({ default: true })
  activo: boolean;

  @OneToMany(() => StudentCourse, (studentCourse) => studentCourse.curso)
  studentCourses: StudentCourse[];
}
