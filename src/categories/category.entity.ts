// src/categories/category.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/** Categoría de cursos (ej: MikroTik, Redes, Seguridad, Fibra Óptica). */
@Entity('categorias')
export class Category {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  nombre: string;

  @Column({ type: 'varchar', nullable: true })
  descripcion: string | null;

  /** Color para mostrar la categoría (hex), ej: #2563eb. */
  @Column({ type: 'varchar', nullable: true })
  color: string | null;

  /** Emoji/ícono opcional para la categoría. */
  @Column({ type: 'varchar', nullable: true })
  icono: string | null;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
