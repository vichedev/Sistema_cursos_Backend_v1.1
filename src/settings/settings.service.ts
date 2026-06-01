// src/settings/settings.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from './setting.entity';

/**
 * Configuración por defecto y mapeo clave-BD → variable .env de fallback.
 * Si la fila no existe en la tabla `configuracion`, se usa el valor del .env
 * (segunda posición) y, si tampoco existe, el valor por defecto (tercera).
 */
const DEFAULTS: Record<string, { env?: string; def: string; secret?: boolean }> = {
  // ── SMTP ────────────────────────────────────────────────────────────────
  // ⚠️  El servidor mail.maat.ec NO responde en 465 (TLS implícito cuelga el
  //     handshake). Sí responde en 587 con STARTTLS → ese es el default sano.
  smtp_host: { env: 'SMTP_HOST', def: '' },
  smtp_port: { env: 'SMTP_PORT', def: '587' },
  smtp_secure: { env: 'SMTP_SECURE', def: 'false' }, // false = STARTTLS (587)
  smtp_user: { env: 'SMTP_USER', def: '' },
  smtp_pass: { env: 'SMTP_PASS', def: '', secret: true },
  smtp_from_name: { def: 'Cursos MAAT' },

  // ── Anti-baneo de correo (envío inteligente) ─────────────────────────────
  mail_delay_ms: { def: '4000' },          // pausa entre correos individuales
  mail_batch_size: { def: '20' },          // correos por lote
  mail_batch_pause_ms: { def: '60000' },   // pausa entre lotes (1 min)
  mail_max_per_connection: { def: '50' },  // mensajes antes de renovar conexión
  mail_rate_per_minute: { def: '30' },     // tope duro de correos/min del pool

  // ── WhatsApp (Baileys nativo) ────────────────────────────────────────────
  wa_enabled: { def: 'true' },
  wa_delay_min_ms: { def: '4000' },        // jitter mínimo entre mensajes
  wa_delay_max_ms: { def: '9000' },        // jitter máximo entre mensajes
  wa_batch_size: { def: '15' },            // mensajes por lote
  wa_batch_pause_ms: { def: '120000' },    // pausa entre lotes (2 min)

  // ── Inteligencia Artificial (compatible OpenAI: DeepSeek, Groq, etc.) ─────
  ai_provider: { def: 'deepseek' }, // deepseek | groq | custom
  ai_api_key: { env: 'DEEPSEEK_API_KEY', def: '', secret: true },
  ai_model: { def: '' },     // vacío = usa el modelo por defecto del proveedor
  ai_base_url: { def: '' },  // solo para "custom"

  // ── Payphone (pasarela de pagos) ──────────────────────────────────────────
  payphone_api_url: { env: 'PAYPHONE_API_URL', def: 'https://pay.payphonetodoesposible.com' },
  payphone_token: { env: 'PAYPHONE_TOKEN', def: '', secret: true },
  payphone_store_id: { env: 'PAYPHONE_STORE_ID', def: '' },
  payphone_timeout: { env: 'PAYPHONE_TIMEOUT', def: '15000' },

  // ── Notificaciones y soporte ──────────────────────────────────────────────
  notif_inscripciones: { env: 'NOTIFICACIONES_INSCRIPCIONES', def: '' },
  notif_alertas: { env: 'ALERTAS_SISTEMA', def: '' },
  soporte_correo: { env: 'CORREO_SOPORTE', def: '' },
  soporte_telefono: { env: 'TELEFONO_SOPORTE', def: '' },
  correos_admin_extra: { env: 'CORREOS_ADMIN_EXTRA', def: '' },

  // ── Contacto público (se muestra en la landing) ──────────────────────────
  contacto_whatsapp: { def: '+593979860095' },
  contacto_whatsapp_nota: { def: 'Chat directo 24/7' },
  contacto_correo: { def: 'cursos@maat.ec' },
  contacto_correo_nota: { def: 'Respuesta en 24h' },
  contacto_pais: { def: 'ECUADOR' },
  contacto_ciudad: { def: 'Guayaquil' },
  contacto_grupo: { def: '✨Grupo Maat✨' },
  // Correo que RECIBE los mensajes del formulario de contacto (vacío = usa contacto_correo / soporte).
  contacto_destino: { def: '' },

  // ── General ──────────────────────────────────────────────────────────────
  frontend_url: { env: 'FRONTEND_URL', def: 'http://localhost:5173' },
};

// Modelos por defecto y endpoints de cada proveedor de IA (todos OpenAI-compatible)
export const AI_PROVIDERS: Record<string, { baseUrl: string; defaultModel: string; label: string }> = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat',
    label: 'DeepSeek',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama-3.3-70b-versatile',
    label: 'Groq',
  },
  custom: {
    baseUrl: '',
    defaultModel: '',
    label: 'Personalizado (OpenAI-compatible)',
  },
};

export type SettingsChangeGroup =
  | 'smtp'
  | 'whatsapp'
  | 'mail'
  | 'ai'
  | 'payphone'
  | 'contacto'
  | 'general';

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private cache = new Map<string, string>();
  private listeners: Array<(group: SettingsChangeGroup) => void> = [];

  constructor(
    @InjectRepository(Setting) private repo: Repository<Setting>,
    private env: ConfigService,
  ) {}

  async onModuleInit() {
    await this.reload();
  }

  /** Recarga la caché completa desde BD. */
  async reload() {
    try {
      const rows = await this.repo.find();
      this.cache.clear();
      for (const row of rows) {
        if (row.valor !== null && row.valor !== undefined) {
          this.cache.set(row.clave, row.valor);
        }
      }
      this.logger.log(`⚙️  Configuración cargada (${rows.length} claves en BD)`);
    } catch (e: any) {
      this.logger.warn(`No se pudo cargar configuración desde BD: ${e.message}`);
    }
  }

  /** Suscribe un callback que se dispara cuando cambia un grupo de config. */
  onChange(cb: (group: SettingsChangeGroup) => void) {
    this.listeners.push(cb);
  }

  private notify(group: SettingsChangeGroup) {
    for (const cb of this.listeners) {
      try {
        cb(group);
      } catch (e: any) {
        this.logger.warn(`Listener de config falló: ${e.message}`);
      }
    }
  }

  // ── Lectura tipada ─────────────────────────────────────────────────────────
  get(key: string): string {
    if (this.cache.has(key)) return this.cache.get(key) as string;
    const meta = DEFAULTS[key];
    if (!meta) return '';
    if (meta.env) {
      const v = this.env.get<string>(meta.env);
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return meta.def;
  }

  getInt(key: string, fallback = 0): number {
    const n = parseInt(this.get(key), 10);
    return Number.isFinite(n) ? n : fallback;
  }

  getBool(key: string): boolean {
    const v = (this.get(key) || '').toString().toLowerCase().trim();
    return v === 'true' || v === '1' || v === 'yes' || v === 'si';
  }

  // ── Escritura ───────────────────────────────────────────────────────────────
  async set(key: string, valor: string | null): Promise<void> {
    await this.repo.save({ clave: key, valor });
    if (valor === null) this.cache.delete(key);
    else this.cache.set(key, valor);
  }

  /**
   * Guarda múltiples claves. Las claves con valor undefined se ignoran (no se
   * tocan). Un valor de password vacío en SMTP se interpreta como "no cambiar".
   */
  async setMany(values: Record<string, any>): Promise<void> {
    const groups = new Set<SettingsChangeGroup>();
    for (const [key, raw] of Object.entries(values)) {
      if (raw === undefined) continue;
      // No sobreescribir secretos con string vacío (el front envía "" para "sin cambio")
      if (DEFAULTS[key]?.secret && (raw === '' || raw === null)) continue;
      const valor = raw === null ? null : String(raw);
      await this.set(key, valor);
      groups.add(this.groupOf(key));
    }
    for (const g of groups) this.notify(g);
  }

  private groupOf(key: string): SettingsChangeGroup {
    if (key.startsWith('smtp_')) return 'smtp';
    if (key.startsWith('mail_')) return 'mail';
    if (key.startsWith('wa_')) return 'whatsapp';
    if (key.startsWith('ai_')) return 'ai';
    if (key.startsWith('payphone_')) return 'payphone';
    if (key.startsWith('contacto_')) return 'contacto';
    return 'general';
  }

  // ── Vistas agrupadas para los servicios consumidores ─────────────────────────
  getSmtpConfig() {
    return {
      host: this.get('smtp_host'),
      port: this.getInt('smtp_port', 587),
      secure: this.getBool('smtp_secure'),
      user: this.get('smtp_user'),
      pass: this.get('smtp_pass'),
      fromName: this.get('smtp_from_name') || 'Cursos MAAT',
    };
  }

  getMailThrottleConfig() {
    return {
      delayMs: this.getInt('mail_delay_ms', 4000),
      batchSize: this.getInt('mail_batch_size', 20),
      batchPauseMs: this.getInt('mail_batch_pause_ms', 60000),
      maxPerConnection: this.getInt('mail_max_per_connection', 50),
      ratePerMinute: this.getInt('mail_rate_per_minute', 30),
    };
  }

  getAiConfig() {
    const provider = (this.get('ai_provider') || 'deepseek').toLowerCase();
    const meta = AI_PROVIDERS[provider] || AI_PROVIDERS.deepseek;
    return {
      provider,
      apiKey: this.get('ai_api_key'),
      model: this.get('ai_model') || meta.defaultModel,
      baseUrl: (this.get('ai_base_url') || meta.baseUrl).trim(),
    };
  }

  getPayphoneConfig() {
    return {
      apiUrl: this.get('payphone_api_url'),
      token: this.get('payphone_token'),
      storeId: this.get('payphone_store_id'),
      timeout: this.getInt('payphone_timeout', 15000),
    };
  }

  getNotificationConfig() {
    return {
      inscripciones: this.get('notif_inscripciones'),
      alertas: this.get('notif_alertas'),
      soporteCorreo: this.get('soporte_correo'),
      soporteTelefono: this.get('soporte_telefono'),
      correosAdminExtra: this.get('correos_admin_extra'),
    };
  }

  /** Datos de contacto que se muestran públicamente en la landing. */
  getContactConfig() {
    return {
      whatsapp: this.get('contacto_whatsapp'),
      whatsappNota: this.get('contacto_whatsapp_nota'),
      correo: this.get('contacto_correo'),
      correoNota: this.get('contacto_correo_nota'),
      pais: this.get('contacto_pais'),
      ciudad: this.get('contacto_ciudad'),
      grupo: this.get('contacto_grupo'),
    };
  }

  /** Correo que recibe los mensajes del formulario de contacto. */
  getContactDestino(): string {
    return (
      this.get('contacto_destino') ||
      this.get('contacto_correo') ||
      this.get('soporte_correo') ||
      this.getSmtpConfig().user
    );
  }

  getWhatsappConfig() {
    return {
      enabled: this.getBool('wa_enabled'),
      delayMinMs: this.getInt('wa_delay_min_ms', 4000),
      delayMaxMs: this.getInt('wa_delay_max_ms', 9000),
      batchSize: this.getInt('wa_batch_size', 15),
      batchPauseMs: this.getInt('wa_batch_pause_ms', 120000),
    };
  }

  /**
   * Calcula automáticamente un plan de envío por lotes (anti-baneo) en función
   * de cuántos destinatarios hay. A mayor audiencia, ritmo más conservador para
   * evitar bloqueos del servidor de correo / WhatsApp.
   *
   * Devuelve los parámetros efectivos + cuántos lotes saldrán y el tiempo
   * estimado total. Lo usan tanto las campañas como las notificaciones de curso.
   *
   * @param total    Número de destinatarios.
   * @param channel  Canal predominante: 'whatsapp' usa la config de WhatsApp
   *                 (más lenta); cualquier otro valor usa la de correo.
   * @param overrides Valores fijados manualmente que tienen prioridad (null/undefined = auto).
   */
  getAutoThrottlePlan(
    total: number,
    channel: 'email' | 'whatsapp' | 'mixed' = 'email',
    overrides: { batchSize?: number | null; delayMs?: number | null; batchPauseMs?: number | null } = {},
  ) {
    const wa = this.getWhatsappConfig();
    const mail = this.getMailThrottleConfig();
    const usaWa = channel === 'whatsapp' || channel === 'mixed';

    let batchSize = overrides.batchSize ?? (usaWa ? wa.batchSize : mail.batchSize);
    let delayMs = overrides.delayMs ?? (usaWa ? wa.delayMinMs : mail.delayMs);
    let batchPauseMs = overrides.batchPauseMs ?? (usaWa ? wa.batchPauseMs : mail.batchPauseMs);

    // Salvaguardas: nunca valores inválidos.
    batchSize = Math.max(1, Math.round(batchSize));
    delayMs = Math.max(0, Math.round(delayMs));
    batchPauseMs = Math.max(0, Math.round(batchPauseMs));

    // Escalado conservador para audiencias grandes (solo si NO se fijó manualmente).
    const n = Math.max(0, Number(total) || 0);
    if (overrides.batchPauseMs == null) {
      if (n > 1000) batchPauseMs = Math.round(batchPauseMs * 1.5);
      else if (n > 300) batchPauseMs = Math.round(batchPauseMs * 1.25);
    }

    const totalBatches = n > 0 ? Math.ceil(n / batchSize) : 0;
    // Tiempo estimado: una pausa entre mensajes por cada envío + pausa entre lotes
    // por cada lote completado salvo el último.
    const etaMs = n > 0 ? n * delayMs + Math.max(0, totalBatches - 1) * batchPauseMs : 0;

    return { batchSize, delayMs, batchPauseMs, total: n, totalBatches, etaMs };
  }

  /**
   * Devuelve toda la config para el panel admin. Los secretos se devuelven
   * enmascarados (solo se indica si hay valor configurado o no).
   */
  getAllForAdmin() {
    const out: Record<string, any> = {};
    for (const [key, meta] of Object.entries(DEFAULTS)) {
      if (meta.secret) {
        out[key] = '';
        out[`${key}_set`] = !!this.get(key);
      } else {
        out[key] = this.get(key);
      }
    }
    return out;
  }
}
