// src/auth/access-log.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Registro de intentos de inicio de sesión (éxitos y fallos). Permite al
 * administrador monitorear quién ingresa y quién tiene problemas de acceso
 * (contraseña incorrecta, cuenta no verificada, etc.) para poder contactarlo.
 */
@Entity('logs_acceso')
export class AccessLog {
  @PrimaryGeneratedColumn()
  id: number;

  /** Usuario o correo que se escribió en el formulario de login. */
  @Index()
  @Column()
  identificador: string;

  /** ID del usuario si se encontró en la BD. */
  @Column({ type: 'int', nullable: true })
  userId: number | null;

  /** Nombre del usuario (si se encontró). */
  @Column({ type: 'varchar', nullable: true })
  nombres: string | null;

  /** Rol del usuario (ADMIN / ESTUDIANTE), si se encontró. */
  @Column({ type: 'varchar', nullable: true })
  rol: string | null;

  /** ¿El intento fue exitoso? */
  @Column({ default: false })
  exito: boolean;

  /** Motivo / resultado: "Ingreso correcto", "Contraseña incorrecta", etc. */
  @Column()
  motivo: string;

  @Column({ type: 'varchar', nullable: true })
  ip: string | null;

  @Column({ type: 'varchar', nullable: true })
  userAgent: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
