// src/campaigns/campaign-recipient.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  UpdateDateColumn,
} from 'typeorm';
import { Campaign } from './campaign.entity';

export type DeliveryState = 'PENDIENTE' | 'ENVIADO' | 'FALLIDO' | 'OMITIDO';

@Entity('campana_destinatarios')
export class CampaignRecipient {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column()
  campaignId: number;

  @ManyToOne(() => Campaign, (c) => c.recipients, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaignId' })
  campaign: Campaign;

  @Column({ type: 'int', nullable: true })
  userId: number | null;

  @Column({ default: '' })
  nombre: string;

  @Column({ type: 'varchar', nullable: true })
  correo: string | null;

  @Column({ type: 'varchar', nullable: true })
  celular: string | null;

  @Column({ default: 'PENDIENTE' })
  emailEstado: DeliveryState;

  @Column({ default: 'PENDIENTE' })
  whatsappEstado: DeliveryState;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
