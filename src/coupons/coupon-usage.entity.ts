// coupon-usage.entity.ts - ACTUALIZAR CON RELACIONES COMPLETAS
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../users/user.entity';
import { Coupon } from './coupon.entity'; // ✅ AGREGAR IMPORT

@Entity('coupon_usage')
@Index(['couponId', 'userId'], { unique: true })
export class CouponUsage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  couponId: number;

  @Column()
  userId: number;

  @Column()
  cursoId: number;

  @CreateDateColumn()
  usadoEn: Date;

  // ✅ AGREGAR ESTADO PARA RESERVA TEMPORAL
  @Column({
    type: 'enum',
    enum: ['RESERVADO', 'USADO'],
    default: 'RESERVADO'
  })
  estado: string;

  // ✅ AGREGAR FECHA DE CONFIRMACIÓN
  @Column({ type: 'timestamp', nullable: true })
  confirmadoEn: Date;

  // Relación con User
  @ManyToOne(() => User, { eager: true })
  @JoinColumn({ name: 'userId' })
  user: User;

  // ✅ AGREGAR RELACIÓN CON COUPON
  @ManyToOne(() => Coupon, { eager: true })
  @JoinColumn({ name: 'couponId' })
  coupon: Coupon;
}