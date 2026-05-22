// src/settings/setting.entity.ts
import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * Almacén clave-valor para la configuración editable en caliente desde
 * el panel administrativo (servidor SMTP, WhatsApp, parámetros anti-baneo, etc.).
 *
 * Cada parámetro se guarda como una fila. El SettingsService cachea los valores
 * y, cuando una clave no existe en BD, hace fallback a la variable de entorno
 * equivalente del archivo .env — de modo que el sistema sigue funcionando
 * exactamente igual aunque la tabla esté vacía.
 */
@Entity('configuracion')
export class Setting {
  @PrimaryColumn({ type: 'varchar', length: 120 })
  clave: string;

  @Column({ type: 'text', nullable: true })
  valor: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
