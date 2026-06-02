// src/courses/course-resource.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Course } from './course.entity';

/**
 * Material didáctico de un curso (PDF, presentaciones, documentos, etc.).
 * Está ligado al curso: si el curso se elimina, sus recursos se eliminan en
 * cascada (onDelete CASCADE).
 */
@Entity('curso_recursos')
export class CourseResource {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Course, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cursoId' })
  curso: Course;

  @Column()
  cursoId: number;

  /** Nombre visible del material. */
  @Column()
  titulo: string;

  /** Enlace externo del material (MEGA, Google Drive, Dropbox, etc.). */
  @Column({ nullable: true })
  url: string;

  /** (Legacy) Nombre del archivo guardado en /uploads, si fue subida directa. */
  @Column({ nullable: true })
  archivo: string;

  /** (Legacy) Nombre original del archivo subido. */
  @Column({ nullable: true })
  nombreOriginal: string;

  /** (Legacy) Tipo MIME del archivo. */
  @Column({ nullable: true })
  mime: string;

  /** (Legacy) Tamaño en bytes. */
  @Column({ type: 'int', nullable: true, default: 0 })
  size: number;

  @CreateDateColumn()
  createdAt: Date;
}
