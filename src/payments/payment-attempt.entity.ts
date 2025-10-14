// payment-attempt.entity.ts - AGREGAR CAMPO
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('payment_attempts')
export class PaymentAttempt {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  @Index()
  clientTransactionId: string;

  @Column()
  cursoId: number;

  @Column()
  userId: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ nullable: true })
  payphoneId: string;

  @Column({ default: 'PENDIENTE' })
  status: string;

  @Column({ type: 'text', nullable: true })
  callbackData: string;

  // ✅ AGREGAR CAMPO PARA RESERVA DE CUPÓN
  @Column({ nullable: true })
  cuponReservaId: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}