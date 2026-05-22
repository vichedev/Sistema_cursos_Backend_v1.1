// src/campaigns/campaign.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { CampaignRecipient } from './campaign-recipient.entity';

export type CampaignSegment = 'TODOS' | 'CURSO' | 'MANUAL';
export type CampaignStatus =
  | 'BORRADOR'
  | 'PROGRAMADA'
  | 'ENVIANDO'
  | 'PAUSADA'
  | 'COMPLETADA'
  | 'CANCELADA'
  | 'FALLIDA';

@Entity('campanas')
export class Campaign {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  nombre: string;

  /** Asunto del correo (no aplica a WhatsApp). */
  @Column({ default: '' })
  asunto: string;

  /** Título/encabezado destacado del mensaje (opcional). */
  @Column({ default: '' })
  titulo: string;

  /** Cuerpo del mensaje. Admite formato ligero: *negrita*, _cursiva_, "- " viñetas. */
  @Column({ type: 'text', default: '' })
  mensaje: string;

  /** Nombres de archivo de las imágenes en /uploads. */
  @Column({ type: 'simple-json', nullable: true })
  imagenes: string[] | null;

  @Column({ default: true })
  canalEmail: boolean;

  @Column({ default: false })
  canalWhatsapp: boolean;

  @Column({ default: 'TODOS' })
  segmento: CampaignSegment;

  @Column({ type: 'int', nullable: true })
  cursoId: number | null;

  /** Para segmento MANUAL: lista libre de destinatarios. */
  @Column({ type: 'simple-json', nullable: true })
  destinatariosManual: Array<{ nombre?: string; correo?: string; celular?: string }> | null;

  @Column({ default: 'BORRADOR' })
  estado: CampaignStatus;

  /** Fecha/hora programada de envío (null = inmediato). */
  @Column({ type: 'timestamp', nullable: true })
  programadaPara: Date | null;

  // ── Parámetros anti-baneo (por campaña; null = usar config global) ──
  @Column({ type: 'int', nullable: true })
  batchSize: number | null;

  @Column({ type: 'int', nullable: true })
  delayMs: number | null;

  @Column({ type: 'int', nullable: true })
  batchPauseMs: number | null;

  // ── Progreso ──
  @Column({ default: 0 })
  total: number;

  @Column({ default: 0 })
  enviadosEmail: number;

  @Column({ default: 0 })
  enviadosWhatsapp: number;

  @Column({ default: 0 })
  fallidos: number;

  @Column({ type: 'int', nullable: true })
  creadoPor: number | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => CampaignRecipient, (r) => r.campaign)
  recipients: CampaignRecipient[];
}
