// src/evaluations/evaluations-admin.service.ts
// Gestión de evaluaciones por el ADMIN (crear, editar, publicar, resultados).
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Course } from '../courses/course.entity';
import { User } from '../users/user.entity';
import { MailService } from '../common/mail.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { Evaluacion } from './evaluacion.entity';
import { EvaluacionPregunta, TipoPregunta } from './evaluacion-pregunta.entity';
import { EvaluacionOpcion } from './evaluacion-opcion.entity';
import { EvaluacionIntento } from './evaluacion-intento.entity';
import { EvaluacionRespuesta } from './evaluacion-respuesta.entity';
import {
  ActualizarEvaluacionDto, CrearEvaluacionDto, GuardarPreguntasDto,
} from './dto/evaluaciones.dto';
import { EvaluationsService, PreguntaConOpciones } from './evaluations.service';
import {
  LIMITES, calificar, escapeHtml, normalizarIds, puedeRecibirCorreo, puedeRecibirWhatsapp,
  redondear2, resumirErrores, validarParaPublicar,
} from './evaluations.util';

const esFinalizado = (i: { estado: string }) => i.estado !== 'EN_CURSO';

/** Filas antiguas o con valor inesperado se tratan como DIAGNOSTICO. */
const tipoDe = (ev: { tipo?: string | null }): 'DIAGNOSTICO' | 'FINAL' =>
  ev.tipo === 'FINAL' ? 'FINAL' : 'DIAGNOSTICO';

const duracionSegundos = (i: { iniciadoEn: Date; enviadoEn: Date | null }) =>
  i.enviadoEn
    ? Math.max(0, Math.round((new Date(i.enviadoEn).getTime() - new Date(i.iniciadoEn).getTime()) / 1000))
    : null;

@Injectable()
export class EvaluationsAdminService {
  private readonly logger = new Logger(EvaluationsAdminService.name);

  constructor(
    private readonly ds: DataSource,
    private readonly core: EvaluationsService,
    private readonly mail: MailService,
    private readonly whatsapp: WhatsappService,
    @InjectRepository(Evaluacion) private readonly evalRepo: Repository<Evaluacion>,
    @InjectRepository(EvaluacionPregunta) private readonly preguntaRepo: Repository<EvaluacionPregunta>,
    @InjectRepository(EvaluacionIntento) private readonly intentoRepo: Repository<EvaluacionIntento>,
    @InjectRepository(EvaluacionRespuesta) private readonly respuestaRepo: Repository<EvaluacionRespuesta>,
    @InjectRepository(Course) private readonly courseRepo: Repository<Course>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  //  Helpers
  // ───────────────────────────────────────────────────────────────────────────

  private async cursoResumen(cursoId: number) {
    const c = await this.courseRepo.findOne({
      where: { id: cursoId },
      select: { id: true, titulo: true, privado: true, imagen: true, activo: true },
    });
    return c;
  }

  private async obtener(id: number): Promise<Evaluacion> {
    const ev = await this.evalRepo.findOne({ where: { id } });
    if (!ev) throw new NotFoundException('Evaluación no encontrada');
    return ev;
  }

  /** Convierte la fecha del DTO (ISO) a Date; null/undefined se conservan. */
  private fecha(v: string | null | undefined): Date | null | undefined {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const d = new Date(v);
    if (isNaN(d.getTime())) throw new BadRequestException('Fecha no válida');
    return d;
  }

  private validarVentana(desde: Date | null, hasta: Date | null) {
    if (desde && hasta && new Date(desde).getTime() >= new Date(hasta).getTime()) {
      throw new BadRequestException('"Disponible hasta" debe ser posterior a "Disponible desde"');
    }
  }

  /** EvaluacionCompleta (solo ADMIN: incluye esCorrecta). */
  async completa(id: number) {
    const ev = await this.obtener(id);
    const curso = await this.cursoResumen(ev.cursoId);
    const preguntas = await this.core.cargarPreguntas(ev.id);
    const totalIntentos = await this.intentoRepo.count({ where: { evaluacionId: ev.id } });
    return {
      id: ev.id,
      cursoId: ev.cursoId,
      curso: {
        id: curso?.id ?? ev.cursoId,
        titulo: curso?.titulo ?? '',
        privado: !!curso?.privado,
        imagen: curso?.imagen ?? null,
      },
      titulo: ev.titulo,
      instrucciones: ev.instrucciones,
      tipo: tipoDe(ev),
      duracionMin: ev.duracionMin,
      intentosMax: ev.intentosMax,
      aleatorizar: ev.aleatorizar,
      estado: ev.estado,
      disponibleDesde: ev.disponibleDesde,
      disponibleHasta: ev.disponibleHasta,
      publicadaEn: ev.publicadaEn,
      createdAt: ev.createdAt,
      updatedAt: ev.updatedAt,
      bloqueada: totalIntentos > 0,
      totalIntentos,
      preguntas: preguntas.map((p) => ({
        id: p.id,
        enunciado: p.enunciado,
        tipo: p.tipo,
        puntos: p.puntos,
        orden: p.orden,
        opciones: p.opciones.map((o) => ({
          id: o.id,
          texto: o.texto,
          esCorrecta: o.esCorrecta,
          orden: o.orden,
        })),
      })),
    };
  }

  /** Último intento finalizado de cada estudiante (por número de intento). */
  private ultimosFinalizados(intentos: EvaluacionIntento[]): Map<number, EvaluacionIntento> {
    const out = new Map<number, EvaluacionIntento>();
    for (const i of intentos) {
      if (!esFinalizado(i)) continue;
      const prev = out.get(i.estudianteId);
      if (!prev || i.numero > prev.numero) out.set(i.estudianteId, i);
    }
    return out;
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Listado
  // ───────────────────────────────────────────────────────────────────────────
  async listar(cursoId?: number) {
    await this.core.finalizarVencidos();

    const evaluaciones = await this.evalRepo.find({
      where: cursoId ? { cursoId } : {},
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    if (!evaluaciones.length) return [];
    const evalIds = evaluaciones.map((e) => e.id);
    const cursoIds = [...new Set(evaluaciones.map((e) => e.cursoId))];

    const cursos = await this.courseRepo.find({
      where: { id: In(cursoIds) },
      select: { id: true, titulo: true, privado: true, imagen: true },
    });
    const cursoMap = new Map(cursos.map((c) => [c.id, c]));
    const accesos = await this.core.idsConAccesoPorCurso(cursos);

    const conteos = await this.preguntaRepo
      .createQueryBuilder('p')
      .select('p.evaluacionId', 'evaluacionId')
      .addSelect('COUNT(*)', 'total')
      .addSelect('COALESCE(SUM(p.puntos), 0)', 'puntos')
      .where('p.evaluacionId IN (:...evalIds)', { evalIds })
      .groupBy('p.evaluacionId')
      .getRawMany();
    const conteoMap = new Map<number, { total: number; puntos: number }>(
      conteos.map((r) => [Number(r.evaluacionId), { total: Number(r.total), puntos: Number(r.puntos) }]),
    );

    const intentos = await this.intentoRepo.find({
      where: { evaluacionId: In(evalIds) },
      select: { id: true, evaluacionId: true, estudianteId: true, numero: true, estado: true, porcentaje: true },
    });
    const porEval = new Map<number, EvaluacionIntento[]>();
    for (const i of intentos) {
      const l = porEval.get(i.evaluacionId) ?? [];
      l.push(i);
      porEval.set(i.evaluacionId, l);
    }

    return evaluaciones.map((ev) => {
      const curso = cursoMap.get(ev.cursoId);
      const mios = porEval.get(ev.id) ?? [];
      const ultimos = this.ultimosFinalizados(mios);
      const porcentajes = [...ultimos.values()].map((i) => Number(i.porcentaje ?? 0));
      // Con acceso al curso + quienes ya la rindieron (aunque luego perdieran el acceso).
      const estudiantes = new Set<number>(accesos.get(ev.cursoId) ?? []);
      for (const i of mios) estudiantes.add(i.estudianteId);
      const c = conteoMap.get(ev.id);
      return {
        id: ev.id,
        cursoId: ev.cursoId,
        curso: {
          id: curso?.id ?? ev.cursoId,
          titulo: curso?.titulo ?? '',
          privado: !!curso?.privado,
          imagen: curso?.imagen ?? null,
        },
        titulo: ev.titulo,
        tipo: tipoDe(ev),
        estado: ev.estado,
        duracionMin: ev.duracionMin,
        intentosMax: ev.intentosMax,
        totalPreguntas: c?.total ?? 0,
        puntajeTotal: c?.puntos ?? 0,
        totalAsignados: estudiantes.size,
        completados: ultimos.size,
        promedio: porcentajes.length
          ? redondear2(porcentajes.reduce((a, b) => a + b, 0) / porcentajes.length)
          : null,
        createdAt: ev.createdAt,
        publicadaEn: ev.publicadaEn,
      };
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Crear / actualizar
  // ───────────────────────────────────────────────────────────────────────────
  async crear(dto: CrearEvaluacionDto, adminId: number | null) {
    const curso = await this.cursoResumen(dto.cursoId);
    if (!curso) throw new NotFoundException('Curso no encontrado');
    // Los exámenes (diagnóstico y final) solo existen para cursos PRIVADOS.
    // Las evaluaciones ya creadas en cursos no privados siguen funcionando.
    if (!curso.privado) {
      throw new BadRequestException('Las evaluaciones solo se pueden crear para cursos privados');
    }

    const desde = this.fecha(dto.disponibleDesde) ?? null;
    const hasta = this.fecha(dto.disponibleHasta) ?? null;
    this.validarVentana(desde, hasta);

    const ev = await this.evalRepo.save(
      this.evalRepo.create({
        cursoId: curso.id,
        titulo: dto.titulo.trim(),
        instrucciones: dto.instrucciones ?? '',
        tipo: dto.tipo === 'FINAL' ? 'FINAL' : 'DIAGNOSTICO',
        duracionMin: dto.duracionMin,
        intentosMax: dto.intentosMax ?? 1,
        aleatorizar: dto.aleatorizar ?? true,
        estado: 'BORRADOR',
        disponibleDesde: desde,
        disponibleHasta: hasta,
        publicadaEn: null,
        creadoPor: adminId,
      }),
    );
    this.logger.log(`📝 Evaluación ${ev.id} (${ev.tipo}) creada para el curso ${curso.id}`);
    return this.completa(ev.id);
  }

  async actualizar(id: number, dto: ActualizarEvaluacionDto) {
    const ev = await this.obtener(id);
    const cambios: Partial<Evaluacion> = {};
    if (dto.titulo != null) cambios.titulo = dto.titulo.trim();
    if (dto.instrucciones != null) cambios.instrucciones = dto.instrucciones;
    if (dto.duracionMin != null) cambios.duracionMin = dto.duracionMin;
    if (dto.intentosMax != null) cambios.intentosMax = dto.intentosMax;
    if (dto.aleatorizar != null) cambios.aleatorizar = dto.aleatorizar;
    // Fechas: null explícito = quitar la fecha; ausente = no tocar.
    const desde = this.fecha(dto.disponibleDesde);
    const hasta = this.fecha(dto.disponibleHasta);
    if (desde !== undefined) cambios.disponibleDesde = desde;
    if (hasta !== undefined) cambios.disponibleHasta = hasta;

    this.validarVentana(
      cambios.disponibleDesde !== undefined ? cambios.disponibleDesde : ev.disponibleDesde,
      cambios.disponibleHasta !== undefined ? cambios.disponibleHasta : ev.disponibleHasta,
    );

    if (Object.keys(cambios).length) await this.evalRepo.update(id, cambios);
    return this.completa(id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Preguntas (reemplazo completo, transaccional)
  // ───────────────────────────────────────────────────────────────────────────

  /** Bloquea la evaluación (FOR UPDATE) y devuelve cuántos intentos tiene. */
  private async bloquearYContar(m: EntityManager, id: number) {
    const ev = await m.findOne(Evaluacion, { where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!ev) throw new NotFoundException('Evaluación no encontrada');
    const intentos = await m.count(EvaluacionIntento, { where: { evaluacionId: id } });
    return { ev, intentos };
  }

  private async insertarPreguntas(
    m: EntityManager,
    evaluacionId: number,
    preguntas: Array<{ enunciado: string; tipo: string; puntos: number; opciones: Array<{ texto: string; esCorrecta: boolean }> }>,
  ) {
    for (let i = 0; i < preguntas.length; i++) {
      const p = preguntas[i];
      const guardada = await m.save(
        m.create(EvaluacionPregunta, {
          evaluacionId,
          enunciado: p.enunciado,
          tipo: p.tipo as TipoPregunta,
          puntos: p.puntos,
          orden: i + 1,
        }),
      );
      if (p.opciones.length) {
        await m.save(
          p.opciones.map((o, j) =>
            m.create(EvaluacionOpcion, {
              preguntaId: guardada.id,
              texto: o.texto,
              esCorrecta: o.esCorrecta === true,
              orden: j + 1,
            }),
          ),
        );
      }
    }
  }

  async guardarPreguntas(id: number, dto: GuardarPreguntasDto) {
    const preguntas = (dto.preguntas || []).map((p) => ({
      enunciado: String(p.enunciado ?? '').trim(),
      tipo: p.tipo,
      puntos: Number(p.puntos),
      opciones: (p.opciones || []).map((o) => ({
        texto: String(o.texto ?? '').trim(),
        esCorrecta: o.esCorrecta === true,
      })),
    }));

    await this.ds.transaction(async (m) => {
      const { ev, intentos } = await this.bloquearYContar(m, id);
      if (intentos > 0) {
        throw new BadRequestException(
          'Esta evaluación ya tiene intentos: no se pueden cambiar sus preguntas. Duplícala para crear una versión nueva.',
        );
      }
      // En BORRADOR se permite guardar incompleto. Si ya está publicada (o
      // cerrada), el set debe seguir siendo válido para rendirse.
      if (ev.estado !== 'BORRADOR') {
        const errores = validarParaPublicar(preguntas);
        if (errores.length) {
          throw new BadRequestException({
            message: `La evaluación está ${ev.estado === 'PUBLICADA' ? 'publicada' : 'cerrada'}: ${resumirErrores(errores)}`,
            errores,
          });
        }
      }
      // Las opciones se eliminan en cascada (FK ON DELETE CASCADE).
      await m.delete(EvaluacionPregunta, { evaluacionId: id });
      await this.insertarPreguntas(m, id, preguntas);
      await m.update(Evaluacion, id, { updatedAt: new Date() });
    });

    return this.completa(id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Publicar / cerrar / reabrir / duplicar / eliminar
  // ───────────────────────────────────────────────────────────────────────────
  async publicar(id: number, notificarCorreo = false, notificarWhatsapp = false) {
    await this.ds.transaction(async (m) => {
      const { ev } = await this.bloquearYContar(m, id);
      if (ev.estado === 'PUBLICADA') throw new BadRequestException('La evaluación ya está publicada');
      if (ev.estado === 'CERRADA') {
        throw new BadRequestException('La evaluación está cerrada. Usa "Reabrir" para volver a publicarla.');
      }
      const curso = await m.findOne(Course, { where: { id: ev.cursoId }, select: { id: true, activo: true } });
      if (!curso) throw new NotFoundException('Curso no encontrado');

      const preguntas = await this.core.cargarPreguntas(id, m);
      const errores = validarParaPublicar(preguntas);
      if (ev.titulo.trim().length === 0) errores.unshift('El título es obligatorio');
      if (!Number.isInteger(ev.duracionMin) || ev.duracionMin < 1 || ev.duracionMin > 300) {
        errores.unshift('La duración debe estar entre 1 y 300 minutos');
      }
      if (errores.length) {
        throw new BadRequestException({
          message: `No se puede publicar: ${resumirErrores(errores)}`,
          errores,
        });
      }
      await m.update(Evaluacion, id, { estado: 'PUBLICADA', publicadaEn: new Date() });
    });

    this.logger.log(`📣 Evaluación ${id} publicada`);
    if (notificarCorreo || notificarWhatsapp) {
      this.notificarPublicacion(id, notificarCorreo, notificarWhatsapp).catch((e) =>
        this.logger.error(`Error notificando la publicación de la evaluación ${id}: ${e?.message}`),
      );
    }
    return this.completa(id);
  }

  async cerrar(id: number) {
    await this.ds.transaction(async (m) => {
      const { ev } = await this.bloquearYContar(m, id);
      if (ev.estado === 'BORRADOR') throw new BadRequestException('La evaluación aún no está publicada');
      if (ev.estado === 'CERRADA') throw new BadRequestException('La evaluación ya está cerrada');
      await m.update(Evaluacion, id, { estado: 'CERRADA' });
      // Los intentos en curso se finalizan y califican con lo respondido.
      const enCurso = await m.find(EvaluacionIntento, {
        where: { evaluacionId: id, estado: 'EN_CURSO' },
        select: { id: true },
      });
      for (const i of enCurso) await this.core.finalizarEnTx(m, i.id, 'CIERRE');
    });
    this.logger.log(`🔒 Evaluación ${id} cerrada`);
    return this.completa(id);
  }

  async reabrir(id: number) {
    await this.ds.transaction(async (m) => {
      const { ev } = await this.bloquearYContar(m, id);
      if (ev.estado !== 'CERRADA') throw new BadRequestException('Solo se puede reabrir una evaluación cerrada');
      await m.update(Evaluacion, id, { estado: 'PUBLICADA' });
    });
    this.logger.log(`🔓 Evaluación ${id} reabierta`);
    return this.completa(id);
  }

  async duplicar(id: number, adminId: number | null) {
    const ev = await this.obtener(id);
    const preguntas = await this.core.cargarPreguntas(id);
    const sufijo = ' (copia)';
    const titulo = ev.titulo.slice(0, LIMITES.titulo - sufijo.length) + sufijo;

    const nuevaId = await this.ds.transaction(async (m) => {
      const copia = await m.save(
        m.create(Evaluacion, {
          cursoId: ev.cursoId,
          titulo,
          instrucciones: ev.instrucciones,
          tipo: ev.tipo,
          duracionMin: ev.duracionMin,
          intentosMax: ev.intentosMax,
          aleatorizar: ev.aleatorizar,
          estado: 'BORRADOR',
          disponibleDesde: ev.disponibleDesde,
          disponibleHasta: ev.disponibleHasta,
          publicadaEn: null,
          creadoPor: adminId,
        }),
      );
      await this.insertarPreguntas(m, copia.id, preguntas);
      return copia.id;
    });
    this.logger.log(`📄 Evaluación ${id} duplicada → ${nuevaId}`);
    return this.completa(nuevaId);
  }

  async eliminar(id: number) {
    await this.ds.transaction(async (m) => {
      const { intentos } = await this.bloquearYContar(m, id);
      if (intentos > 0) {
        throw new BadRequestException(
          'Esta evaluación ya tiene intentos de estudiantes. Ciérrala en lugar de eliminarla',
        );
      }
      await m.delete(Evaluacion, id); // preguntas y opciones caen en cascada
    });
    this.logger.log(`🗑️ Evaluación ${id} eliminada`);
    return { success: true };
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Resultados
  // ───────────────────────────────────────────────────────────────────────────
  async resultados(id: number) {
    await this.core.finalizarVencidos(id);
    const ev = await this.obtener(id);
    const curso = await this.cursoResumen(ev.cursoId);
    const preguntas = await this.core.cargarPreguntas(id);
    const intentos = await this.intentoRepo.find({
      where: { evaluacionId: id },
      order: { numero: 'ASC' },
    });

    // Estudiantes: con acceso al curso + quienes tengan algún intento.
    const accesos = curso ? await this.core.idsConAccesoPorCurso([curso]) : new Map<number, Set<number>>();
    const ids = new Set<number>(accesos.get(ev.cursoId) ?? []);
    for (const i of intentos) ids.add(i.estudianteId);
    const usuarios = ids.size
      ? await this.userRepo.find({
          where: { id: In([...ids]) },
          select: { id: true, nombres: true, apellidos: true, correo: true },
        })
      : [];

    const porEstudiante = new Map<number, EvaluacionIntento[]>();
    for (const i of intentos) {
      const l = porEstudiante.get(i.estudianteId) ?? [];
      l.push(i);
      porEstudiante.set(i.estudianteId, l);
    }
    const ultimos = this.ultimosFinalizados(intentos);

    const estudiantes = usuarios
      .map((u) => {
        const mios = porEstudiante.get(u.id) ?? [];
        const finalizados = mios.filter(esFinalizado);
        const ultimo = ultimos.get(u.id) ?? null;
        const estado: 'PENDIENTE' | 'EN_CURSO' | 'COMPLETADO' = finalizados.length
          ? 'COMPLETADO'
          : mios.length
            ? 'EN_CURSO'
            : 'PENDIENTE';
        return {
          estudianteId: u.id,
          nombres: u.nombres,
          apellidos: u.apellidos,
          correo: u.correo,
          estado,
          intentosUsados: mios.length,
          mejorPorcentaje: finalizados.length
            ? Math.max(...finalizados.map((i) => Number(i.porcentaje ?? 0)))
            : null,
          ultimoPorcentaje: ultimo ? Number(ultimo.porcentaje ?? 0) : null,
          ultimoIntentoId: ultimo ? ultimo.id : null,
          enviadoEn: ultimo ? ultimo.enviadoEn : null,
          duracionSegundos: ultimo ? duracionSegundos(ultimo) : null,
        };
      })
      .sort(
        (a, b) =>
          String(a.apellidos || '').localeCompare(String(b.apellidos || ''), 'es') ||
          String(a.nombres || '').localeCompare(String(b.nombres || ''), 'es'),
      );

    // Resumen (sobre el ÚLTIMO intento finalizado de cada estudiante)
    const porcentajes = estudiantes
      .filter((e) => e.estado === 'COMPLETADO' && e.ultimoPorcentaje !== null)
      .map((e) => e.ultimoPorcentaje as number);
    const rangos: Array<[string, number, number]> = [
      ['0-20', -Infinity, 20],
      ['21-40', 20, 40],
      ['41-60', 40, 60],
      ['61-80', 60, 80],
      ['81-100', 80, Infinity],
    ];
    const distribucion = rangos.map(([rango, min, max]) => ({
      rango,
      cantidad: porcentajes.filter((p) => p > min && p <= max).length,
    }));
    const completados = estudiantes.filter((e) => e.estado === 'COMPLETADO').length;
    const enCurso = estudiantes.filter((e) => e.estado === 'EN_CURSO').length;

    // Estadística por pregunta (mismo universo: último intento finalizado)
    const ultimosIds = [...ultimos.values()].map((i) => i.id);
    const respuestas = ultimosIds.length
      ? await this.respuestaRepo.find({ where: { intentoId: In(ultimosIds) } })
      : [];
    const respPorPregunta = new Map<number, EvaluacionRespuesta[]>();
    for (const r of respuestas) {
      const l = respPorPregunta.get(r.preguntaId) ?? [];
      l.push(r);
      respPorPregunta.set(r.preguntaId, l);
    }
    const totalFinalizados = ultimosIds.length;

    const statsPreguntas = preguntas.map((p) => {
      const rs = (respPorPregunta.get(p.id) ?? []).filter((r) => normalizarIds(r.opcionIds).length > 0);
      const correctas = rs.filter((r) => r.correcta === true).length;
      const veces = new Map<number, number>();
      for (const r of rs) {
        for (const oid of normalizarIds(r.opcionIds)) veces.set(oid, (veces.get(oid) ?? 0) + 1);
      }
      return {
        preguntaId: p.id,
        orden: p.orden,
        enunciado: p.enunciado,
        tipo: p.tipo,
        puntos: p.puntos,
        respondidas: rs.length,
        correctas,
        // Sobre todos los que finalizaron (no responder cuenta como fallo).
        porcentajeAcierto: totalFinalizados ? redondear2((correctas / totalFinalizados) * 100) : 0,
        opciones: p.opciones.map((o) => ({
          id: o.id,
          texto: o.texto,
          esCorrecta: o.esCorrecta,
          veces: veces.get(o.id) ?? 0,
        })),
      };
    });

    return {
      evaluacion: {
        id: ev.id,
        titulo: ev.titulo,
        tipo: tipoDe(ev),
        estado: ev.estado,
        duracionMin: ev.duracionMin,
        intentosMax: ev.intentosMax,
        totalPreguntas: preguntas.length,
        puntajeTotal: preguntas.reduce((s, p) => s + (Number(p.puntos) || 0), 0),
        curso: { id: curso?.id ?? ev.cursoId, titulo: curso?.titulo ?? '', privado: !!curso?.privado },
      },
      resumen: {
        totalEstudiantes: estudiantes.length,
        completados,
        pendientes: estudiantes.length - completados - enCurso,
        enCurso,
        promedio: porcentajes.length
          ? redondear2(porcentajes.reduce((a, b) => a + b, 0) / porcentajes.length)
          : null,
        maximo: porcentajes.length ? Math.max(...porcentajes) : null,
        minimo: porcentajes.length ? Math.min(...porcentajes) : null,
        distribucion,
      },
      estudiantes,
      preguntas: statsPreguntas,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Comparativa diagnóstico inicial vs examen final (por curso)
  // ───────────────────────────────────────────────────────────────────────────
  async comparativa(cursoId: number, diagnosticoId?: number, finalId?: number) {
    const curso = await this.cursoResumen(cursoId);
    if (!curso) throw new BadRequestException('Curso no encontrado');
    if (!curso.privado) {
      throw new BadRequestException('La comparativa solo está disponible para cursos privados');
    }

    const delCurso = await this.evalRepo.find({
      where: { cursoId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    const rendibles = delCurso.filter((e) => e.estado === 'PUBLICADA' || e.estado === 'CERRADA');

    // Id explícito: debe ser del curso y del tipo pedido. Sin id: la más
    // reciente (por createdAt) PUBLICADA o CERRADA de ese tipo, o null.
    const elegir = (tipo: 'DIAGNOSTICO' | 'FINAL', id?: number): Evaluacion | null => {
      const nombre = tipo === 'FINAL' ? 'finalId' : 'diagnosticoId';
      if (id === undefined) return rendibles.find((e) => tipoDe(e) === tipo) ?? null;
      const ev = delCurso.find((e) => e.id === id);
      if (!ev) throw new BadRequestException(`${nombre}: la evaluación no pertenece a este curso`);
      if (tipoDe(ev) !== tipo) {
        throw new BadRequestException(
          `${nombre}: la evaluación no es de tipo ${tipo === 'FINAL' ? 'examen final' : 'diagnóstico'}`,
        );
      }
      return ev;
    };
    const diag = elegir('DIAGNOSTICO', diagnosticoId);
    const fin = elegir('FINAL', finalId);
    const evalIds = [diag, fin].filter((e): e is Evaluacion => !!e).map((e) => e.id);

    for (const id of evalIds) await this.core.finalizarVencidos(id);

    const conteoMap = new Map<number, { total: number; puntos: number }>();
    const intentos: EvaluacionIntento[] = [];
    if (evalIds.length) {
      const conteos = await this.preguntaRepo
        .createQueryBuilder('p')
        .select('p.evaluacionId', 'evaluacionId')
        .addSelect('COUNT(*)', 'total')
        .addSelect('COALESCE(SUM(p.puntos), 0)', 'puntos')
        .where('p.evaluacionId IN (:...evalIds)', { evalIds })
        .groupBy('p.evaluacionId')
        .getRawMany();
      for (const r of conteos) {
        conteoMap.set(Number(r.evaluacionId), { total: Number(r.total), puntos: Number(r.puntos) });
      }
      intentos.push(
        ...(await this.intentoRepo.find({
          where: { evaluacionId: In(evalIds) },
          order: { numero: 'ASC' },
        })),
      );
    }

    // Mismo criterio que `resultados`: último intento finalizado de cada estudiante.
    const ultimosDiag = diag
      ? this.ultimosFinalizados(intentos.filter((i) => i.evaluacionId === diag.id))
      : new Map<number, EvaluacionIntento>();
    const ultimosFin = fin
      ? this.ultimosFinalizados(intentos.filter((i) => i.evaluacionId === fin.id))
      : new Map<number, EvaluacionIntento>();

    // Estudiantes: con acceso al curso ∪ con algún intento en cualquiera de las dos.
    const accesos = await this.core.idsConAccesoPorCurso([curso]);
    const ids = new Set<number>(accesos.get(curso.id) ?? []);
    for (const i of intentos) ids.add(i.estudianteId);
    const usuarios = ids.size
      ? await this.userRepo.find({
          where: { id: In([...ids]) },
          select: { id: true, nombres: true, apellidos: true, correo: true },
        })
      : [];

    const celda = (i: EvaluacionIntento | undefined) =>
      i
        ? {
            porcentaje: Number(i.porcentaje ?? 0),
            puntaje: Number(i.puntaje ?? 0),
            puntajeMax: Number(i.puntajeMax ?? 0),
            enviadoEn: i.enviadoEn,
            intentoId: i.id,
          }
        : null;

    const estudiantes = usuarios
      .map((u) => {
        const d = celda(ultimosDiag.get(u.id));
        const f = celda(ultimosFin.get(u.id));
        return {
          estudianteId: u.id,
          nombres: u.nombres,
          apellidos: u.apellidos,
          correo: u.correo,
          diagnostico: d,
          final: f,
          delta: d && f ? redondear2(f.porcentaje - d.porcentaje) : null,
        };
      })
      .sort(
        (a, b) =>
          String(a.apellidos || '').localeCompare(String(b.apellidos || ''), 'es') ||
          String(a.nombres || '').localeCompare(String(b.nombres || ''), 'es'),
      );

    const promedio = (xs: number[]) =>
      xs.length ? redondear2(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
    const pctDiag = estudiantes.filter((e) => e.diagnostico).map((e) => e.diagnostico!.porcentaje);
    const pctFin = estudiantes.filter((e) => e.final).map((e) => e.final!.porcentaje);
    const deltas = estudiantes.filter((e) => e.delta !== null).map((e) => e.delta as number);
    const UMBRAL = 0.01;

    const resumenEval = (ev: Evaluacion | null) =>
      ev
        ? {
            id: ev.id,
            titulo: ev.titulo,
            estado: ev.estado,
            totalPreguntas: conteoMap.get(ev.id)?.total ?? 0,
            puntajeTotal: conteoMap.get(ev.id)?.puntos ?? 0,
          }
        : null;
    const opcion = (e: Evaluacion) => ({ id: e.id, titulo: e.titulo, estado: e.estado });

    return {
      curso: { id: curso.id, titulo: curso.titulo, privado: !!curso.privado },
      diagnostico: resumenEval(diag),
      final: resumenEval(fin),
      disponibles: {
        diagnosticos: rendibles.filter((e) => tipoDe(e) === 'DIAGNOSTICO').map(opcion),
        finales: rendibles.filter((e) => tipoDe(e) === 'FINAL').map(opcion),
      },
      resumen: {
        totalEstudiantes: estudiantes.length,
        conDiagnostico: pctDiag.length,
        conFinal: pctFin.length,
        conAmbos: deltas.length,
        promedioDiagnostico: promedio(pctDiag),
        promedioFinal: promedio(pctFin),
        mejoraPromedio: promedio(deltas),
        mejoraron: deltas.filter((d) => d >= UMBRAL).length,
        empeoraron: deltas.filter((d) => d <= -UMBRAL).length,
        igual: deltas.filter((d) => Math.abs(d) < UMBRAL).length,
      },
      estudiantes,
      preguntas: null,
    };
  }

  /** Detalle de un intento, pregunta por pregunta (solo ADMIN). */
  async detalleIntento(intentoId: number) {
    let intento = await this.intentoRepo.findOne({ where: { id: intentoId } });
    if (!intento) throw new NotFoundException('Intento no encontrado');
    // Si ya venció y el cron aún no pasó, se finaliza ahora.
    if (intento.estado === 'EN_CURSO') {
      await this.core.finalizarVencidos(intento.evaluacionId);
      intento = (await this.intentoRepo.findOne({ where: { id: intentoId } })) ?? intento;
    }

    const ev = await this.obtener(intento.evaluacionId);
    const estudiante = await this.userRepo.findOne({
      where: { id: intento.estudianteId },
      select: { id: true, nombres: true, apellidos: true, correo: true },
    });
    const preguntas: PreguntaConOpciones[] = await this.core.cargarPreguntas(ev.id);
    const filas = await this.respuestaRepo.find({ where: { intentoId: intento.id } });
    const elegidas = new Map<number, number[]>(filas.map((r) => [r.preguntaId, normalizarIds(r.opcionIds)]));
    const guardadas = new Map(filas.map((r) => [r.preguntaId, r]));

    // Finalizado → lo que quedó calificado. En curso → calificación provisional.
    const finalizado = esFinalizado(intento);
    const provisional = new Map(calificar(preguntas, elegidas).porPregunta.map((r) => [r.preguntaId, r]));

    return {
      intento: {
        id: intento.id,
        numero: intento.numero,
        estado: intento.estado,
        iniciadoEn: intento.iniciadoEn,
        enviadoEn: intento.enviadoEn,
        puntaje: intento.puntaje === null ? null : Number(intento.puntaje),
        puntajeMax: Number(intento.puntajeMax ?? 0),
        porcentaje: intento.porcentaje === null ? null : Number(intento.porcentaje),
        duracionSegundos: duracionSegundos(intento),
      },
      estudiante: {
        id: estudiante?.id ?? intento.estudianteId,
        nombres: estudiante?.nombres ?? '',
        apellidos: estudiante?.apellidos ?? '',
        correo: estudiante?.correo ?? '',
      },
      evaluacion: { id: ev.id, titulo: ev.titulo },
      respuestas: preguntas.map((p) => {
        const fila = guardadas.get(p.id);
        const prov = provisional.get(p.id);
        const correcta =
          finalizado && fila && fila.correcta !== null ? fila.correcta === true : (prov?.correcta ?? false);
        const puntosObtenidos =
          finalizado && fila && fila.puntos !== null ? Number(fila.puntos) : (prov?.puntos ?? 0);
        const marcadas = new Set(elegidas.get(p.id) ?? []);
        return {
          preguntaId: p.id,
          orden: p.orden,
          enunciado: p.enunciado,
          tipo: p.tipo,
          puntos: p.puntos,
          correcta,
          puntosObtenidos,
          opciones: p.opciones.map((o) => ({
            id: o.id,
            texto: o.texto,
            esCorrecta: o.esCorrecta,
            elegida: marcadas.has(o.id),
          })),
        };
      }),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Notificación de publicación (segundo plano, solo estudiantes con acceso)
  // ───────────────────────────────────────────────────────────────────────────

  /** Estudiantes con acceso a la evaluación que pueden recibir aviso por algún canal. */
  async destinatariosPublicacion(id: number, correo: boolean, whatsapp: boolean): Promise<User[]> {
    const ev = await this.obtener(id);
    const curso = await this.cursoResumen(ev.cursoId);
    if (!curso || !curso.activo) return [];
    const accesos = await this.core.idsConAccesoPorCurso([curso]);
    const ids = [...(accesos.get(curso.id) ?? [])];
    if (!ids.length) return [];
    const usuarios = await this.userRepo.find({ where: { id: In(ids), activo: true } });
    return usuarios.filter(
      (u) => (correo && puedeRecibirCorreo(u)) || (whatsapp && puedeRecibirWhatsapp(u)),
    );
  }

  private async notificarPublicacion(id: number, correo: boolean, whatsapp: boolean) {
    const ev = await this.obtener(id);
    const curso = await this.cursoResumen(ev.cursoId);
    const destinatarios = await this.destinatariosPublicacion(id, correo, whatsapp);
    if (!destinatarios.length) {
      this.logger.log(`📢 Evaluación ${id}: no hay estudiantes con acceso a quienes notificar`);
      return 0;
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://cursos.maat.ec';
    const waConectado = whatsapp ? !!this.whatsapp.getStatus().connected : false;
    if (whatsapp && !waConectado) {
      this.logger.warn('⚠️ WhatsApp no está conectado: se omiten los avisos por WhatsApp.');
    }
    const cursoTitulo = curso?.titulo ?? '';
    const esExamenFinal = tipoDe(ev) === 'FINAL';

    // MailService y WhatsappService encolan y espacian los envíos (anti-baneo).
    for (const est of destinatarios) {
      if (correo && puedeRecibirCorreo(est)) {
        const html = `
<div style="font-family:Arial,sans-serif;color:#222;max-width:600px;margin:0 auto;">
  <h2 style="color:#ff6b35;">📝 Tienes ${esExamenFinal ? 'un examen final' : 'una evaluación de diagnóstico'}</h2>
  <p>Hola <b>${escapeHtml(est.nombres)}</b>,</p>
  <p style="font-size:16px;line-height:1.5;">Ya está disponible ${esExamenFinal ? 'el examen final' : 'la evaluación'} <b>${escapeHtml(ev.titulo)}</b> del curso <b>${escapeHtml(cursoTitulo)}</b>.</p>
  <div style="background:#f8f9fa;padding:15px;border-radius:8px;margin:20px 0;">
    <p><b>⏱️ Duración:</b> ${ev.duracionMin} minutos</p>
    <p><b>🔁 Intentos:</b> ${ev.intentosMax}</p>
  </div>
  <p style="font-size:14px;line-height:1.5;color:#555;">Una vez que la inicies, el tiempo no se detiene. Ríndela con calma y buena conexión.</p>
  <div style="text-align:center;margin:25px 0;">
    <a href="${escapeHtml(frontendUrl)}" style="background:#ff6b35;color:white;padding:12px 30px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;font-size:16px;">
      🚀 Ir a la plataforma
    </a>
  </div>
  <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
  <small style="color:#999;">Sistema de Cursos MAAT</small>
</div>`.trim();
        this.mail
          .sendMail(est.correo, `📝 ${esExamenFinal ? 'Examen final' : 'Evaluación de diagnóstico'}: ${ev.titulo}`, html)
          .then(() => this.logger.log(`📧 Aviso de evaluación enviado a ${est.correo}`))
          .catch((e) => this.logger.error(`❌ Error correo a ${est.correo}: ${e?.message}`));
      }
      if (whatsapp && waConectado && puedeRecibirWhatsapp(est)) {
        const mensaje = `📝 *${esExamenFinal ? 'EXAMEN FINAL' : 'EVALUACIÓN DE DIAGNÓSTICO'}*

Hola ${est.nombres} 👋

Ya está disponible ${esExamenFinal ? 'el examen final' : 'la evaluación'}:
📋 *${ev.titulo}*
📚 Curso: ${cursoTitulo}

⏱️ *Duración:* ${ev.duracionMin} minutos
🔁 *Intentos:* ${ev.intentosMax}

Ingresa a la plataforma para rendirla:
${frontendUrl}`;
        this.whatsapp
          .sendText(est.celular, mensaje)
          .then(() => this.logger.log(`📱 Aviso de evaluación enviado a ${est.celular}`))
          .catch((e) => this.logger.error(`❌ Error WhatsApp a ${est.celular}: ${e?.message}`));
      }
    }
    this.logger.log(`📢 Evaluación ${id}: aviso encolado para ${destinatarios.length} estudiante(s)`);
    return destinatarios.length;
  }
}
