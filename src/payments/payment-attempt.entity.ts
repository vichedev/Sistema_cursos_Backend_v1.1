// src/payments/payment-attempt.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('payment_attempts') // Nombre de la tabla en tu base de datos
export class PaymentAttempt {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true }) // Asegura que este ID sea único
  @Index() // Agregar índice para búsquedas más rápidas
  clientTransactionId: string; // El UUID que generas y envías a Payphone

  @Column()
  cursoId: number; // El ID del curso asociado al pago

  @Column()
  userId: number; // El ID del usuario que intenta pagar

  @Column({ type: 'decimal', precision: 10, scale: 2 }) // Monto del pago
  amount: number;

  @Column({ nullable: true })
  payphoneId: string; // El ID de transacción que Payphone te devuelve (ej. vRGau75DNESLaFf1O3ggQA)

  @Column({ default: 'PENDIENTE' })
  status: string; // Ej: 'PENDIENTE', 'Approved', 'Declined', 'ERROR_PROCESAMIENTO_INTERNO', etc.

  @Column({ type: 'text', nullable: true })
  callbackData: string; // Para almacenar el callback completo de Payphone

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}