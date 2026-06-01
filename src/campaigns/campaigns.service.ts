// src/campaigns/campaigns.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';

import { Campaign } from './campaign.entity';
import { CampaignRecipient } from './campaign-recipient.entity';
import { User } from '../users/user.entity';
import { StudentCourse } from '../courses/student-course.entity';
import { MailService, MailAttachment } from '../common/mail.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { SettingsService } from '../settings/settings.service';

const UPLOADS_DIR = join(process.cwd(), 'uploads');

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);
  // Control en memoria del envío en curso.
  private running = new Set<number>();
  private control = new Map<number, { paused: boolean; cancelled: boolean }>();

  constructor(
    @InjectRepository(Campaign) private campaignRepo: Repository<Campaign>,
    @InjectRepository(CampaignRecipient) private recipientRepo: Repository<CampaignRecipient>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(StudentCourse) private studentCourseRepo: Repository<StudentCourse>,
    private mail: MailService,
    private whatsapp: WhatsappService,
    private settings: SettingsService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  //  CRUD
  // ───────────────────────────────────────────────────────────────────────────
  async create(data: any, imagenes: string[], creadoPor?: number): Promise<Campaign> {
    const canalEmail = this.toBool(data.canalEmail, true);
    const canalWhatsapp = this.toBool(data.canalWhatsapp, false);
    if (!canalEmail && !canalWhatsapp) {
      throw new BadRequestException('Selecciona al menos un canal (correo o WhatsApp)');
    }

    const segmento = (data.segmento || 'TODOS').toUpperCase();
    let programadaPara: Date | null = null;
    if (data.programadaPara) {
      const d = new Date(data.programadaPara);
      if (!isNaN(d.getTime())) programadaPara = d;
    }

    const campaign = this.campaignRepo.create({
      nombre: data.nombre || 'Campaña sin nombre',
      asunto: data.asunto || '',
      titulo: data.titulo || '',
      mensaje: data.mensaje || '',
      imagenes: imagenes.length ? imagenes : null,
      canalEmail,
      canalWhatsapp,
      segmento,
      cursoId: data.cursoId ? Number(data.cursoId) : null,
      destinatariosManual: this.parseManual(data.destinatariosManual),
      programadaPara,
      batchSize: data.batchSize ? Number(data.batchSize) : null,
      delayMs: data.delayMs ? Number(data.delayMs) : null,
      batchPauseMs: data.batchPauseMs ? Number(data.batchPauseMs) : null,
      estado: programadaPara ? 'PROGRAMADA' : 'BORRADOR',
      creadoPor: creadoPor ?? null,
    });

    const saved = await this.campaignRepo.save(campaign);

    // Construir lista de destinatarios y persistirla
    const recipients = await this.buildRecipients(saved);
    if (recipients.length === 0) {
      throw new BadRequestException(
        'No se encontraron destinatarios válidos para el segmento seleccionado',
      );
    }
    await this.recipientRepo.save(
      recipients.map((r) =>
        this.recipientRepo.create({
          campaignId: saved.id,
          userId: r.userId ?? null,
          nombre: r.nombre || '',
          correo: r.correo || null,
          celular: r.celular || null,
          emailEstado: canalEmail && r.correo ? 'PENDIENTE' : 'OMITIDO',
          whatsappEstado: canalWhatsapp && r.celular ? 'PENDIENTE' : 'OMITIDO',
        }),
      ),
    );
    saved.total = recipients.length;
    await this.campaignRepo.save(saved);

    this.logger.log(
      `📣 Campaña #${saved.id} "${saved.nombre}" creada — ${recipients.length} destinatarios (${saved.estado})`,
    );
    return saved;
  }

  /** Estados en los que una campaña todavía se puede editar. */
  private readonly EDITABLE = new Set(['BORRADOR', 'PROGRAMADA', 'CANCELADA', 'FALLIDA']);

  /**
   * Actualiza una campaña editable (borrador / programada / cancelada / fallida)
   * y reconstruye su lista de destinatarios. Permite conservar imágenes ya
   * subidas (imagenesExistentes) y añadir nuevas.
   */
  async update(id: number, data: any, nuevasImagenes: string[]): Promise<Campaign> {
    const campaign = await this.findOne(id);
    if (this.running.has(id) || !this.EDITABLE.has(campaign.estado)) {
      throw new BadRequestException(
        `No se puede editar una campaña en estado ${campaign.estado}. Solo se editan borradores, programadas, canceladas o fallidas.`,
      );
    }

    const canalEmail = this.toBool(data.canalEmail, campaign.canalEmail);
    const canalWhatsapp = this.toBool(data.canalWhatsapp, campaign.canalWhatsapp);
    if (!canalEmail && !canalWhatsapp) {
      throw new BadRequestException('Selecciona al menos un canal (correo o WhatsApp)');
    }

    // Imágenes: conservar las indicadas + añadir las nuevas; borrar del disco las descartadas.
    const conservadas = this.parseStringArray(data.imagenesExistentes);
    const previas = campaign.imagenes || [];
    const finales = [...previas.filter((img) => conservadas.includes(img)), ...nuevasImagenes];
    for (const img of previas) {
      if (!finales.includes(img)) this.deleteImageFile(img);
    }

    let programadaPara: Date | null = null;
    if (data.programadaPara) {
      const d = new Date(data.programadaPara);
      if (!isNaN(d.getTime())) programadaPara = d;
    }

    campaign.nombre = data.nombre ?? campaign.nombre;
    campaign.asunto = data.asunto ?? campaign.asunto;
    campaign.titulo = data.titulo ?? campaign.titulo;
    campaign.mensaje = data.mensaje ?? campaign.mensaje;
    campaign.imagenes = finales.length ? finales : null;
    campaign.canalEmail = canalEmail;
    campaign.canalWhatsapp = canalWhatsapp;
    campaign.segmento = (data.segmento || campaign.segmento || 'TODOS').toUpperCase();
    campaign.cursoId = data.cursoId ? Number(data.cursoId) : null;
    if (data.destinatariosManual !== undefined) {
      campaign.destinatariosManual = this.parseManual(data.destinatariosManual);
    }
    campaign.programadaPara = programadaPara;
    campaign.batchSize = data.batchSize ? Number(data.batchSize) : null;
    campaign.delayMs = data.delayMs ? Number(data.delayMs) : null;
    campaign.batchPauseMs = data.batchPauseMs ? Number(data.batchPauseMs) : null;
    campaign.estado = programadaPara ? 'PROGRAMADA' : 'BORRADOR';
    // Reinicia el progreso porque se reconstruye la audiencia.
    campaign.enviadosEmail = 0;
    campaign.enviadosWhatsapp = 0;
    campaign.fallidos = 0;
    campaign.startedAt = null;
    campaign.finishedAt = null;

    const saved = await this.campaignRepo.save(campaign);

    // Reconstruir destinatarios desde cero.
    const recipients = await this.buildRecipients(saved);
    if (recipients.length === 0) {
      throw new BadRequestException(
        'No se encontraron destinatarios válidos para el segmento seleccionado',
      );
    }
    await this.recipientRepo.delete({ campaignId: saved.id });
    await this.recipientRepo.save(
      recipients.map((r) =>
        this.recipientRepo.create({
          campaignId: saved.id,
          userId: r.userId ?? null,
          nombre: r.nombre || '',
          correo: r.correo || null,
          celular: r.celular || null,
          emailEstado: canalEmail && r.correo ? 'PENDIENTE' : 'OMITIDO',
          whatsappEstado: canalWhatsapp && r.celular ? 'PENDIENTE' : 'OMITIDO',
        }),
      ),
    );
    saved.total = recipients.length;
    await this.campaignRepo.save(saved);

    this.logger.log(`✏️  Campaña #${saved.id} actualizada — ${recipients.length} destinatarios (${saved.estado})`);
    return saved;
  }

  /**
   * Previsualiza la audiencia de un segmento (sin persistir) y devuelve el plan
   * de envío automático calculado para ese tamaño. Lo usa el formulario para
   * mostrar en vivo cuántos destinatarios hay y cuántos lotes saldrán.
   */
  async previewAudience(query: {
    segmento?: string;
    cursoId?: any;
    canalEmail?: any;
    canalWhatsapp?: any;
    destinatariosManual?: any;
  }) {
    const canalEmail = this.toBool(query.canalEmail, true);
    const canalWhatsapp = this.toBool(query.canalWhatsapp, false);
    const pseudo = {
      segmento: (query.segmento || 'TODOS').toUpperCase(),
      cursoId: query.cursoId ? Number(query.cursoId) : null,
      canalEmail,
      canalWhatsapp,
      destinatariosManual: this.parseManual(query.destinatariosManual),
    } as Campaign;

    const recipients = await this.buildRecipients(pseudo);
    const conCorreo = recipients.filter((r) => r.correo).length;
    const conWhatsapp = recipients.filter((r) => r.celular).length;
    const plan = this.settings.getAutoThrottlePlan(recipients.length, this.channelOf(pseudo));

    return { total: recipients.length, conCorreo, conWhatsapp, plan };
  }

  async findAll(): Promise<Campaign[]> {
    return this.campaignRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: number): Promise<Campaign> {
    const c = await this.campaignRepo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Campaña no encontrada');
    return c;
  }

  /** Detalle con resumen de destinatarios para el panel. */
  async getDetail(id: number) {
    const campaign = await this.findOne(id);
    const recipients = await this.recipientRepo.find({
      where: { campaignId: id },
      order: { id: 'ASC' },
      take: 500,
    });
    return { ...campaign, recipients };
  }

  async remove(id: number): Promise<void> {
    const campaign = await this.findOne(id);
    if (this.running.has(id)) {
      throw new BadRequestException('No se puede eliminar una campaña en envío. Cancélala primero.');
    }
    // Borrar imágenes asociadas
    for (const img of campaign.imagenes || []) {
      const p = join(UPLOADS_DIR, img);
      try {
        if (existsSync(p)) unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
    await this.recipientRepo.delete({ campaignId: id });
    await this.campaignRepo.delete(id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Control de envío
  // ───────────────────────────────────────────────────────────────────────────
  async send(id: number): Promise<{ message: string }> {
    const campaign = await this.findOne(id);
    if (this.running.has(id)) return { message: 'La campaña ya se está enviando' };
    if (['COMPLETADA', 'ENVIANDO'].includes(campaign.estado)) {
      throw new BadRequestException(`La campaña está en estado ${campaign.estado}`);
    }
    if (campaign.canalWhatsapp && !this.whatsapp.getStatus().connected) {
      this.logger.warn('⚠️  Campaña con WhatsApp pero el cliente no está conectado');
    }
    // Lanzar el motor en segundo plano
    this.runEngine(id).catch((e) => this.logger.error(`Error motor campaña #${id}: ${e.message}`));
    return { message: 'Envío iniciado' };
  }

  async pause(id: number): Promise<{ message: string }> {
    await this.findOne(id);
    const ctrl = this.control.get(id);
    if (ctrl && this.running.has(id)) {
      ctrl.paused = true;
      await this.campaignRepo.update(id, { estado: 'PAUSADA' });
      return { message: 'Campaña pausada' };
    }
    return { message: 'La campaña no está en envío' };
  }

  async resume(id: number): Promise<{ message: string }> {
    const campaign = await this.findOne(id);
    if (campaign.estado !== 'PAUSADA') {
      throw new BadRequestException('La campaña no está pausada');
    }
    this.runEngine(id).catch((e) => this.logger.error(`Error reanudando #${id}: ${e.message}`));
    return { message: 'Campaña reanudada' };
  }

  async cancel(id: number): Promise<{ message: string }> {
    await this.findOne(id);
    const ctrl = this.control.get(id);
    if (ctrl) ctrl.cancelled = true;
    await this.campaignRepo.update(id, { estado: 'CANCELADA', finishedAt: new Date() });
    return { message: 'Campaña cancelada' };
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Motor de envío por lotes (anti-baneo)
  // ───────────────────────────────────────────────────────────────────────────
  private async runEngine(id: number) {
    if (this.running.has(id)) return;
    this.running.add(id);
    const ctrl = { paused: false, cancelled: false };
    this.control.set(id, ctrl);

    try {
      const campaign = await this.findOne(id);

      await this.campaignRepo.update(id, {
        estado: 'ENVIANDO',
        startedAt: campaign.startedAt || new Date(),
      });

      // Destinatarios aún pendientes en cualquiera de los canales
      const pending = await this.recipientRepo.find({
        where: { campaignId: id },
        order: { id: 'ASC' },
      });
      const toProcess = pending.filter(
        (r) => r.emailEstado === 'PENDIENTE' || r.whatsappEstado === 'PENDIENTE',
      );

      // Plan anti-baneo automático según cuántos quedan por enviar. Los valores
      // fijados manualmente en la campaña tienen prioridad sobre el cálculo auto.
      const plan = this.settings.getAutoThrottlePlan(
        toProcess.length,
        this.channelOf(campaign),
        { batchSize: campaign.batchSize, delayMs: campaign.delayMs, batchPauseMs: campaign.batchPauseMs },
      );
      const { batchSize, delayMs, batchPauseMs } = plan;
      this.logger.log(
        `📦 Campaña #${id}: ${toProcess.length} pendientes en ${plan.totalBatches} lote(s) de ${batchSize}; ` +
          `~${Math.round(plan.etaMs / 1000)}s estimados`,
      );

      const attachments = this.buildEmailAttachments(campaign);
      const emailHtml = this.buildEmailHtml(campaign);

      let processedInBatch = 0;

      for (const r of toProcess) {
        if (ctrl.cancelled) {
          this.logger.log(`🛑 Campaña #${id} cancelada`);
          return;
        }
        if (ctrl.paused) {
          this.logger.log(`⏸️  Campaña #${id} pausada`);
          return; // resume relanza el motor
        }

        let huboError = false;

        // ── Correo ──
        if (campaign.canalEmail && r.correo && r.emailEstado === 'PENDIENTE') {
          try {
            await this.mail.sendMailNow(
              r.correo,
              campaign.asunto || campaign.nombre,
              emailHtml,
              attachments,
            );
            r.emailEstado = 'ENVIADO';
            await this.campaignRepo.increment({ id }, 'enviadosEmail', 1);
          } catch (e: any) {
            r.emailEstado = 'FALLIDO';
            r.error = `email: ${e.message}`;
            huboError = true;
          }
        }

        // ── WhatsApp ──
        if (campaign.canalWhatsapp && r.celular && r.whatsappEstado === 'PENDIENTE') {
          if (!this.whatsapp.getStatus().connected) {
            r.whatsappEstado = 'FALLIDO';
            r.error = (r.error ? r.error + ' | ' : '') + 'whatsapp: no conectado';
            huboError = true;
          } else {
            try {
              await this.sendWhatsappCampaign(campaign, r.celular);
              r.whatsappEstado = 'ENVIADO';
              await this.campaignRepo.increment({ id }, 'enviadosWhatsapp', 1);
            } catch (e: any) {
              r.whatsappEstado = 'FALLIDO';
              r.error = (r.error ? r.error + ' | ' : '') + `whatsapp: ${e.message}`;
              huboError = true;
            }
          }
        }

        if (huboError) await this.campaignRepo.increment({ id }, 'fallidos', 1);
        await this.recipientRepo.save(r);

        processedInBatch++;
        // Pausa anti-baneo
        if (processedInBatch >= batchSize) {
          processedInBatch = 0;
          this.logger.log(`⏸️  Campaña #${id}: pausa de lote ${batchPauseMs / 1000}s`);
          await this.sleepInterruptible(batchPauseMs, ctrl);
        } else {
          await this.sleepInterruptible(delayMs, ctrl);
        }
      }

      // Finalizar
      const fresh = await this.findOne(id);
      const algoEnviado = fresh.enviadosEmail > 0 || fresh.enviadosWhatsapp > 0;
      await this.campaignRepo.update(id, {
        estado: algoEnviado ? 'COMPLETADA' : 'FALLIDA',
        finishedAt: new Date(),
      });
      this.logger.log(
        `✅ Campaña #${id} finalizada — emails:${fresh.enviadosEmail} wa:${fresh.enviadosWhatsapp} fallidos:${fresh.fallidos}`,
      );
    } finally {
      this.running.delete(id);
      this.control.delete(id);
    }
  }

  private async sendWhatsappCampaign(campaign: Campaign, celular: string) {
    const imgs = campaign.imagenes || [];
    const texto = this.buildWhatsappText(campaign);
    if (imgs.length === 0) {
      await this.whatsapp.sendText(celular, texto || campaign.nombre);
      return;
    }
    // Primera imagen con el texto como pie de foto
    await this.whatsapp.sendImage(celular, join(UPLOADS_DIR, imgs[0]), texto || undefined);
    // Imágenes adicionales sin texto
    for (let i = 1; i < imgs.length; i++) {
      await this.whatsapp.sendImage(celular, join(UPLOADS_DIR, imgs[i]));
    }
  }

  /** Construye el texto de WhatsApp con formato (título en negrita + cuerpo). */
  private buildWhatsappText(campaign: Campaign): string {
    const cuerpo = this.formatToWhatsapp(campaign.mensaje || '');
    if (campaign.titulo) return `*${campaign.titulo}*\n\n${cuerpo}`.trim();
    return cuerpo;
  }

  private async sleepInterruptible(ms: number, ctrl: { paused: boolean; cancelled: boolean }) {
    const step = 1000;
    let waited = 0;
    while (waited < ms) {
      if (ctrl.cancelled || ctrl.paused) return;
      await new Promise((r) => setTimeout(r, Math.min(step, ms - waited)));
      waited += step;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Construcción de destinatarios y contenido
  // ───────────────────────────────────────────────────────────────────────────
  private async buildRecipients(
    campaign: Campaign,
  ): Promise<Array<{ userId?: number; nombre?: string; correo?: string; celular?: string }>> {
    let list: Array<{ userId?: number; nombre?: string; correo?: string; celular?: string }> = [];

    if (campaign.segmento === 'TODOS') {
      const users = await this.userRepo.find({ where: { rol: 'ESTUDIANTE', activo: true } });
      list = users.map((u) => ({
        userId: u.id,
        nombre: `${u.nombres} ${u.apellidos}`.trim(),
        correo: u.correo,
        celular: u.celular,
      }));
    } else if (campaign.segmento === 'CURSO') {
      if (!campaign.cursoId) throw new BadRequestException('Falta el curso para el segmento CURSO');
      const inscripciones = await this.studentCourseRepo.find({
        where: { cursoId: campaign.cursoId },
      });
      list = inscripciones
        .filter((sc) => sc.estudiante)
        .map((sc) => ({
          userId: sc.estudiante.id,
          nombre: `${sc.estudiante.nombres} ${sc.estudiante.apellidos}`.trim(),
          correo: sc.estudiante.correo,
          celular: sc.estudiante.celular,
        }));
    } else if (campaign.segmento === 'MANUAL') {
      list = (campaign.destinatariosManual || []).map((d) => ({
        nombre: d.nombre,
        correo: d.correo,
        celular: d.celular,
      }));
    }

    // Filtrar quienes no tengan ningún canal útil y deduplicar por correo+celular
    const seen = new Set<string>();
    return list.filter((r) => {
      const hasChannel =
        (campaign.canalEmail && r.correo) || (campaign.canalWhatsapp && r.celular);
      if (!hasChannel) return false;
      const key = `${(r.correo || '').toLowerCase()}|${(r.celular || '').replace(/\D/g, '')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private buildEmailAttachments(campaign: Campaign): MailAttachment[] {
    const imgs = campaign.imagenes || [];
    return imgs.map((img, i) => ({
      filename: img,
      path: join(UPLOADS_DIR, img),
      cid: `campimg${i}`,
    }));
  }

  private buildEmailHtml(campaign: Campaign): string {
    const bodyHtml = this.formatToHtml(campaign.mensaje || '');
    const imgs = campaign.imagenes || [];
    const imagesHtml = imgs
      .map(
        (_img, i) =>
          `<div style="margin:0 0 14px;text-align:center"><img src="cid:campimg${i}" alt="" style="max-width:100%;border-radius:12px;display:block;margin:0 auto"></div>`,
      )
      .join('');
    const frontendUrl = this.settings.get('frontend_url');
    const tituloHtml = campaign.titulo
      ? `<h1 style="font-size:22px;color:#111827;margin:0 0 14px;line-height:1.3">${this.escapeHtml(campaign.titulo)}</h1>`
      : '';

    return `
<div style="background:#f3f4f6;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#ff6b35,#f7931e);padding:22px 24px;text-align:center">
      <span style="color:#fff;font-size:20px;font-weight:bold;letter-spacing:.3px">MAAT Academy</span>
    </div>
    <div style="padding:26px 28px;color:#1f2937">
      ${imgs.length ? imagesHtml : ''}
      ${tituloHtml}
      <div style="font-size:16px;color:#374151">${bodyHtml}</div>
      <div style="text-align:center;margin:28px 0 8px">
        <a href="${frontendUrl}" style="background:#ff6b35;color:#fff;padding:13px 34px;text-decoration:none;border-radius:10px;font-weight:bold;display:inline-block;font-size:15px">
          Ver nuestros cursos
        </a>
      </div>
    </div>
    <div style="background:#f9fafb;padding:16px 24px;text-align:center;border-top:1px solid #eee">
      <small style="color:#9ca3af;font-size:12px">Recibes este correo porque eres parte de MAAT Academy.</small>
    </div>
  </div>
</div>`.trim();
  }

  /** Convierte el formato ligero del mensaje a HTML para correo. */
  private formatToHtml(text: string): string {
    const inline = (s: string) =>
      this.escapeHtml(s)
        .replace(/\*(.+?)\*/g, '<strong>$1</strong>')
        .replace(/_(.+?)_/g, '<em>$1</em>')
        .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" style="color:#ff6b35">$1</a>');

    const lines = (text || '').split('\n');
    let html = '';
    let inList = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('- ') || line.startsWith('• ')) {
        if (!inList) {
          html += '<ul style="margin:10px 0;padding-left:22px">';
          inList = true;
        }
        html += `<li style="margin:5px 0">${inline(line.replace(/^[-•]\s+/, ''))}</li>`;
      } else {
        if (inList) {
          html += '</ul>';
          inList = false;
        }
        if (line === '') html += '<div style="height:10px"></div>';
        else html += `<p style="margin:10px 0;line-height:1.6">${inline(line)}</p>`;
      }
    }
    if (inList) html += '</ul>';
    return html;
  }

  /** Normaliza el formato para WhatsApp (ya soporta *negrita* y _cursiva_ nativas). */
  private formatToWhatsapp(text: string): string {
    return (text || '')
      .split('\n')
      .map((l) => l.replace(/^\s*-\s+/, '• '))
      .join('\n');
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Programación automática
  // ───────────────────────────────────────────────────────────────────────────
  @Cron('*/30 * * * * *') // cada 30s
  async checkScheduled() {
    const now = new Date();
    const due = await this.campaignRepo.find({ where: { estado: 'PROGRAMADA' } });
    for (const c of due) {
      if (c.programadaPara && c.programadaPara <= now && !this.running.has(c.id)) {
        this.logger.log(`⏰ Lanzando campaña programada #${c.id} "${c.nombre}"`);
        this.runEngine(c.id).catch((e) =>
          this.logger.error(`Error campaña programada #${c.id}: ${e.message}`),
        );
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Helpers
  // ───────────────────────────────────────────────────────────────────────────
  private toBool(v: any, def = false): boolean {
    if (v === undefined || v === null || v === '') return def;
    return v === true || v === 'true' || v === '1' || v === 1;
  }

  /** Canal predominante de una campaña para elegir la config anti-baneo. */
  private channelOf(c: { canalEmail?: boolean; canalWhatsapp?: boolean }): 'email' | 'whatsapp' | 'mixed' {
    if (c.canalWhatsapp && c.canalEmail) return 'mixed';
    if (c.canalWhatsapp) return 'whatsapp';
    return 'email';
  }

  /** Borra del disco una imagen de /uploads de forma segura. */
  private deleteImageFile(img: string): void {
    try {
      const p = join(UPLOADS_DIR, img);
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* ignore */
    }
  }

  /** Parsea un arreglo de strings que pudo llegar como JSON o como valor suelto. */
  private parseStringArray(v: any): string[] {
    if (!v) return [];
    if (Array.isArray(v)) return v.filter((x) => typeof x === 'string');
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string');
    } catch {
      if (typeof v === 'string') return [v];
    }
    return [];
  }

  private parseManual(v: any): Array<any> | null {
    if (!v) return null;
    if (Array.isArray(v)) return v;
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
