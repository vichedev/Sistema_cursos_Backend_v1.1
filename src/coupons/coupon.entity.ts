// coupon.entity.ts - ACTUALIZAR RELACIÓN
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { Course } from '../courses/course.entity';
import { CouponUsage } from './coupon-usage.entity';

// ✅ DEFINIR Y EXPORTAR EL TIPO (ACTUALIZADO)
export type CouponType = 'PORCENTAJE_10' | 'PORCENTAJE_15' | 'PORCENTAJE_30' | 'PORCENTAJE_50' | 'GRATIS';

@Entity('course_coupons')
export class Coupon {
  @PrimaryGeneratedColumn()
  id: number;

  // ✅ MEJORAR LA RELACIÓN
  @ManyToOne(() => Course, (course) => course.cupones, {
    onDelete: 'CASCADE',
    eager: true
  })
  @JoinColumn({ name: 'cursoId' })
  curso: Course;

  @Column()
  cursoId: number;

  @Column({ unique: true })
  codigo: string;

  @Column()
  tipo: CouponType;

  @Column()
  usosMaximos: number;

  @Column({ default: 0 })
  usosActuales: number;

  @Column({ type: 'date', nullable: true })
  fechaExpiracion: Date | null;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn()
  createdAt: Date;

  // ✅ AGREGAR RELACIÓN CON COUPON USAGE
  @OneToMany(() => CouponUsage, couponUsage => couponUsage.coupon)
  usos: CouponUsage[];
}