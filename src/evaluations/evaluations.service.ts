// src/evaluations/evaluations.service.ts
// Núcleo del módulo de evaluaciones + flujo del ESTUDIANTE (rendir).
//
// REGLAS DE SEGURIDAD (no negociables):
//  - Ninguna respuesta a estudiantes incluye `esCorrecta`, conteo de aciertos
//    ni corrección por pregunta: solo puntaje / puntajeMax / porcentaje.
//  - La calificación y el control del tiempo ocurren SOLO en el servidor.
//  - Todo endpoint de intento verifica que el intento sea del usuario (403).
import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, LessThan, Repository } from 'typeorm';
import { Course } from '../courses/course.entity';
import { StudentCourse } from '../courses/student-course.entity';
import { CourseAssignment } from '../courses/course-assignment.entity';
import { Evaluacion } from './evaluacion.entity';
import { EvaluacionPregunta } from './evaluacion-pregunta.entity';
import { EvaluacionOpcion } from './evaluacion-opcion.entity';
import { EvaluacionIntento } from './evaluacion-intento.entity';
import { EvaluacionRespuesta } from './evaluacion-respuesta.entity';
import { GuardarRespuestaDto } from './dto/evaluaciones.dto';
import { GRACIA_MS, calificar, construirOrden, normalizarIds } from './evaluations.util';

export interface PreguntaConOpciones {
  id: number;
  enunciado: string;
  tipo: string;
  puntos: number;
  orden: number;
  opciones: Array<{ id: number; texto: string; esCorrecta: boolean; orden: number }>;
}

export type MotivoFin = 'ENVIO' | 'EXPIRADO' | 'CIERRE';

const esFinalizado = (i: { estado: string }) => i.estado !== 'EN_CURSO';

@Injectable()
export class EvaluationsService {
  private readonly logger = new Logger(EvaluationsService.name);

  constructor(
    private readonly ds: DataSource,
    @InjectRepository(Evaluacion) private readonly evalRepo: Repository<Evaluacion>,
    @InjectRepository(EvaluacionIntento) private readonly intentoRepo: Repository<EvaluacionIntento>,
    @InjectRepository(EvaluacionRespuesta) private readonly respuestaRepo: Repository<EvaluacionRespuesta>,
    @InjectRepository(Course) private readonly courseRepo: Repository<Course>,
    @InjectRepository(StudentCourse) private readonly studentCourseRepo: Repository<StudentCourse>,
    @InjectRepository(CourseAssignment) private readonly asignacionRepo: Repository<CourseAssignment>,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  //  Helpers compartidos (también los usa el servicio de admin)
  // ───────────────────────────────────────────────────────────────────────────

  /** Preguntas de una evaluación con sus opciones, en el orden definido por el admin. */
  async cargarPreguntas(evaluacionId: number, m?: EntityManager): Promise<PreguntaConOpciones[]> {
    const manager = m ?? this.ds.manager;
    const preguntas = await manager.find(EvaluacionPregunta, {
      where: { evaluacionId },
      order: { orden: 'ASC', id: 'ASC' },
    });
    if (!preguntas.length) return [];
    const opciones = await manager.find(EvaluacionOpcion, {
      where: { preguntaId: In(preguntas.map((p) => p.id)) },
      order: { orden: 'ASC', id: 'ASC' },
    });
    const porPregunta = new Map<number, PreguntaConOpciones['opciones']>();
    for (const o of opciones) {
      const lista = porPregunta.get(o.preguntaId) ?? [];
      lista.push({ id: o.id, texto: o.texto, esCorrecta: o.esCorrecta, orden: o.orden });
      porPregunta.set(o.preguntaId, lista);
    }
    return preguntas.map((p) => ({
      id: p.id,
      enunciado: p.enunciado,
      tipo: p.tipo,
      puntos: p.puntos,
      orden: p.orden,
      opciones: porPregunta.get(p.id) ?? [],
    }));
  }

  /**
   * Regla de acceso del estudiante a las evaluaciones de un curso:
   *   curso ACTIVO  Y  ( inscrito  O  (curso privado Y asignado) ).
   */
  async tieneAcceso(curso: Pick<Course, 'id' | 'activo' | 'privado'> | null, userId: number): Promise<boolean> {
    if (!curso || !curso.activo) return false;
    const inscrito = await this.studentCourseRepo.count({
      where: { cursoId: curso.id, estudianteId: userId },
    });
    if (inscrito > 0) return true;
    if (!curso.privado) return false;
    const asignado = await this.asignacionRepo.count({
      where: { cursoId: curso.id, estudianteId: userId },
    });
    return asignado > 0;
  }

  /** Ids de los estudiantes con acceso a las evaluaciones de cada curso indicado. */
  async idsConAccesoPorCurso(cursos: Array<Pick<Course, 'id' | 'privado'>>): Promise<Map<number, Set<number>>> {
    const out = new Map<number, Set<number>>();
    for (const c of cursos) out.set(c.id, new Set<number>());
    const ids = [...out.keys()];
    if (!ids.length) return out;

    const inscritos = await this.studentCourseRepo
      .createQueryBuilder('sc')
      .select('sc.cursoId', 'cursoId')
      .addSelect('sc.estudianteId', 'estudianteId')
      .where('sc.cursoId IN (:...ids)', { ids })
      .distinct(true)
      .getRawMany();
    for (const r of inscritos) out.get(Number(r.cursoId))?.add(Number(r.estudianteId));

    const privados = cursos.filter((c) => c.privado).map((c) => c.id);
    if (privados.length) {
      const asignados = await this.asignacionRepo.find({
        where: { cursoId: In(privados) },
        select: { id: true, cursoId: true, estudianteId: true },
      });
      for (const a of asignados) out.get(a.cursoId)?.add(a.estudianteId);
    }
    return out;
  }

  private vencido(intento: EvaluacionIntento, ahora = Date.now()): boolean {
    return ahora > new Date(intento.expiraEn).getTime() + GRACIA_MS;
  }

  private resultadoDe(intento: EvaluacionIntento) {
    // SEGURIDAD: lo ÚNICO que ve el estudiante de su calificación.
    return {
      puntaje: Number(intento.puntaje ?? 0),
      puntajeMax: Number(intento.puntajeMax ?? 0),
      porcentaje: Number(intento.porcentaje ?? 0),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Finalización + calificación (transaccional, con bloqueo de fila)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Finaliza y califica un intento dentro de la transacción `m`.
   * Bloquea la fila (FOR UPDATE): si otro proceso (cron, otra pestaña) ya lo
   * finalizó, devuelve el intento tal cual (idempotente).
   */
  async finalizarEnTx(m: EntityManager, intentoId: number, motivo: MotivoFin): Promise<EvaluacionIntento | null> {
    const intento = await m.findOne(EvaluacionIntento, {
      where: { id: intentoId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!intento) return null;
    if (esFinalizado(intento)) return intento;

    const ahora = new Date();
    const expiraEn = new Date(intento.expiraEn);
    const preguntas = await this.cargarPreguntas(intento.evaluacionId, m);
    const respuestas = await m.find(EvaluacionRespuesta, { where: { intentoId: intento.id } });
    const mapa = new Map<number, number[]>(respuestas.map((r) => [r.preguntaId, normalizarIds(r.opcionIds)]));
    const cal = calificar(preguntas, mapa);
    const porPregunta = new Map(cal.porPregunta.map((r) => [r.preguntaId, r]));

    for (const r of respuestas) {
      const res = porPregunta.get(r.preguntaId);
      // SQL directo para no alterar updatedAt (conserva cuándo respondió el estudiante).
      await m.query(
        `UPDATE "evaluacion_respuestas" SET "correcta" = $1, "puntos" = $2 WHERE "id" = $3`,
        [res ? res.correcta : false, res ? res.puntos : 0, r.id],
      );
    }

    // ENVIADO solo si lo envió el estudiante dentro del tiempo (+ gracia).
    const aTiempo = !this.vencido(intento, ahora.getTime());
    intento.estado = motivo === 'ENVIO' && aTiempo ? 'ENVIADO' : 'EXPIRADO';
    intento.enviadoEn =
      intento.estado === 'ENVIADO' ? ahora : ahora.getTime() < expiraEn.getTime() ? ahora : expiraEn;
    intento.puntaje = cal.puntaje;
    intento.puntajeMax = cal.puntajeMax;
    intento.porcentaje = cal.porcentaje;
    await m.update(EvaluacionIntento, intento.id, {
      estado: intento.estado,
      enviadoEn: intento.enviadoEn,
      puntaje: intento.puntaje,
      puntajeMax: intento.puntajeMax,
      porcentaje: intento.porcentaje,
    });
    return intento;
  }

  async finalizarIntento(intentoId: number, motivo: MotivoFin): Promise<EvaluacionIntento | null> {
    return this.ds.transaction((m) => this.finalizarEnTx(m, intentoId, motivo));
  }

  /** Finaliza y califica los intentos EN_CURSO cuyo tiempo (+ gracia) ya venció. */
  async finalizarVencidos(evaluacionId?: number): Promise<number> {
    const corte = new Date(Date.now() - GRACIA_MS);
    const vencidos = await this.intentoRepo.find({
      where: {
        estado: 'EN_CURSO',
        expiraEn: LessThan(corte),
        ...(evaluacionId ? { evaluacionId } : {}),
      },
      select: { id: true },
      take: 500,
    });
    let n = 0;
    for (const v of vencidos) {
      try {
        const fin = await this.finalizarIntento(v.id, 'EXPIRADO');
        if (fin && esFinalizado(fin)) n++;
      } catch (e: any) {
        this.logger.error(`No se pudo finalizar el intento ${v.id}: ${e?.message}`);
      }
    }
    return n;
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  ESTUDIANTE
  // ───────────────────────────────────────────────────────────────────────────

  /** Diagnósticos visibles para el estudiante con su estado. */
  async misDiagnosticos(userId: number) {
    // 1) Cursos activos con acceso (inscrito, o asignado si es privado)
    const inscripciones = await this.studentCourseRepo
      .createQueryBuilder('sc')
      .select('sc.cursoId', 'cursoId')
      .where('sc.estudianteId = :userId', { userId })
      .getRawMany();
    const asignaciones = await this.asignacionRepo.find({
      where: { estudianteId: userId },
      select: { id: true, cursoId: true },
    });
    const inscritoEn = new Set<number>(inscripciones.map((r) => Number(r.cursoId)));
    const asignadoEn = new Set<number>(asignaciones.map((a) => a.cursoId));
    const candidatos = [...new Set([...inscritoEn, ...asignadoEn])];
    if (!candidatos.length) return [];

    const cursos = (
      await this.courseRepo.find({
        where: { id: In(candidatos), activo: true },
        select: { id: true, titulo: true, imagen: true, privado: true, activo: true },
      })
    ).filter((c) => inscritoEn.has(c.id) || (c.privado && asignadoEn.has(c.id)));
    if (!cursos.length) return [];
    const cursoMap = new Map(cursos.map((c) => [c.id, c]));

    // 2) Evaluaciones publicadas o cerradas de esos cursos
    const evaluaciones = await this.evalRepo.find({
      where: { cursoId: In(cursos.map((c) => c.id)), estado: In(['PUBLICADA', 'CERRADA']) },
      order: { publicadaEn: 'DESC', id: 'DESC' },
    });
    if (!evaluaciones.length) return [];
    const evalIds = evaluaciones.map((e) => e.id);

    // 3) Intentos del estudiante (finalizando antes los que ya vencieron)
    let intentos = await this.intentoRepo.find({
      where: { evaluacionId: In(evalIds), estudianteId: userId },
      order: { numero: 'ASC' },
    });
    const ahora = Date.now();
    const vencidos = intentos.filter((i) => i.estado === 'EN_CURSO' && this.vencido(i, ahora));
    if (vencidos.length) {
      for (const v of vencidos) await this.finalizarIntento(v.id, 'EXPIRADO');
      intentos = await this.intentoRepo.find({
        where: { evaluacionId: In(evalIds), estudianteId: userId },
        order: { numero: 'ASC' },
      });
    }
    const intentosPorEval = new Map<number, EvaluacionIntento[]>();
    for (const i of intentos) {
      const l = intentosPorEval.get(i.evaluacionId) ?? [];
      l.push(i);
      intentosPorEval.set(i.evaluacionId, l);
    }

    // 4) Número de preguntas por evaluación
    const conteos = await this.ds
      .getRepository(EvaluacionPregunta)
      .createQueryBuilder('p')
      .select('p.evaluacionId', 'evaluacionId')
      .addSelect('COUNT(*)', 'total')
      .where('p.evaluacionId IN (:...evalIds)', { evalIds })
      .groupBy('p.evaluacionId')
      .getRawMany();
    const totalPreguntas = new Map<number, number>(conteos.map((r) => [Number(r.evaluacionId), Number(r.total)]));

    // 5) Progreso (inicial → final): último porcentaje finalizado del PROPIO
    //    estudiante en el diagnóstico más reciente (por createdAt) de cada curso.
    //    SEGURIDAD: solo porcentajes propios; nada de corrección por pregunta.
    const ultimoPorcentajeEn = (evaluacionId: number): number | null => {
      const fin = (intentosPorEval.get(evaluacionId) ?? []).filter(esFinalizado);
      return fin.length ? Number(fin[fin.length - 1].porcentaje ?? 0) : null;
    };
    const diagnosticoPorCurso = new Map<number, Evaluacion>();
    for (const ev of evaluaciones) {
      if (ev.tipo === 'FINAL') continue;
      const prev = diagnosticoPorCurso.get(ev.cursoId);
      const t = new Date(ev.createdAt).getTime();
      const tPrev = prev ? new Date(prev.createdAt).getTime() : -Infinity;
      if (!prev || t > tPrev || (t === tPrev && ev.id > prev.id)) diagnosticoPorCurso.set(ev.cursoId, ev);
    }

    const out: any[] = [];
    for (const ev of evaluaciones) {
      const mios = intentosPorEval.get(ev.id) ?? [];
      // CERRADA solo se muestra si el estudiante llegó a rendirla.
      if (ev.estado === 'CERRADA' && mios.length === 0) continue;

      const finalizados = mios.filter(esFinalizado);
      const enCurso = mios.find((i) => i.estado === 'EN_CURSO') ?? null;
      const ultimo = finalizados.length ? finalizados[finalizados.length - 1] : null;
      const intentosUsados = mios.length;
      const intentosRestantes = Math.max(0, ev.intentosMax - intentosUsados);
      const mejor = finalizados.length
        ? Math.max(...finalizados.map((i) => Number(i.porcentaje ?? 0)))
        : null;

      let estado: 'DISPONIBLE' | 'EN_CURSO' | 'COMPLETADO' | 'PROXIMAMENTE' | 'CERRADO';
      const antes = !!ev.disponibleDesde && ahora < new Date(ev.disponibleDesde).getTime();
      const despues = !!ev.disponibleHasta && ahora > new Date(ev.disponibleHasta).getTime();
      if (enCurso) estado = 'EN_CURSO';
      else if (ev.estado === 'CERRADA') estado = 'COMPLETADO';
      else if (intentosRestantes === 0) estado = 'COMPLETADO';
      else if (antes) estado = 'PROXIMAMENTE';
      else if (despues) estado = intentosUsados > 0 ? 'COMPLETADO' : 'CERRADO';
      else estado = 'DISPONIBLE';

      const curso = cursoMap.get(ev.cursoId)!;
      const esFinal = ev.tipo === 'FINAL';
      const diag = esFinal ? diagnosticoPorCurso.get(ev.cursoId) : undefined;
      out.push({
        id: ev.id,
        titulo: ev.titulo,
        tipo: esFinal ? 'FINAL' : 'DIAGNOSTICO',
        instrucciones: ev.instrucciones,
        duracionMin: ev.duracionMin,
        intentosMax: ev.intentosMax,
        totalPreguntas: totalPreguntas.get(ev.id) ?? 0,
        disponibleDesde: ev.disponibleDesde,
        disponibleHasta: ev.disponibleHasta,
        curso: { id: curso.id, titulo: curso.titulo, imagen: curso.imagen ?? null, privado: !!curso.privado },
        estado,
        intentosUsados,
        intentosRestantes,
        mejorPorcentaje: mejor,
        ultimoPorcentaje: ultimo ? Number(ultimo.porcentaje ?? 0) : null,
        intentoEnCursoId: enCurso ? enCurso.id : null,
        completadoEn: ultimo ? ultimo.enviadoEn : null,
        progreso: esFinal
          ? {
              diagnostico: diag ? ultimoPorcentajeEn(diag.id) : null,
              final: ultimo ? Number(ultimo.porcentaje ?? 0) : null,
            }
          : null,
      });
    }
    return out;
  }

  /**
   * IntentoPayload: lo que el estudiante ve mientras rinde.
   * SEGURIDAD: cada campo se copia explícitamente; `esCorrecta` nunca sale de aquí.
   */
  private async construirPayload(intento: EvaluacionIntento) {
    const ev = await this.evalRepo.findOne({ where: { id: intento.evaluacionId } });
    if (!ev) throw new NotFoundException('Evaluación no encontrada');
    const curso = await this.courseRepo.findOne({
      where: { id: ev.cursoId },
      select: { id: true, titulo: true },
    });
    const preguntas = await this.cargarPreguntas(ev.id);
    const porId = new Map(preguntas.map((p) => [p.id, p]));

    const orden = intento.orden?.preguntas ?? [];
    const vistas = new Set<number>();
    const salida: Array<{ id: number; enunciado: string; tipo: string; puntos: number; opciones: Array<{ id: number; texto: string }> }> = [];
    const agregar = (p: PreguntaConOpciones, ordenOpciones: number[]) => {
      const opPorId = new Map(p.opciones.map((o) => [o.id, o]));
      const usadas = new Set<number>();
      const opciones: Array<{ id: number; texto: string }> = [];
      for (const oid of ordenOpciones) {
        const o = opPorId.get(oid);
        if (o && !usadas.has(o.id)) {
          usadas.add(o.id);
          opciones.push({ id: o.id, texto: o.texto });
        }
      }
      for (const o of p.opciones) {
        if (!usadas.has(o.id)) opciones.push({ id: o.id, texto: o.texto });
      }
      salida.push({ id: p.id, enunciado: p.enunciado, tipo: p.tipo, puntos: p.puntos, opciones });
      vistas.add(p.id);
    };
    for (const item of orden) {
      const p = porId.get(item.id);
      if (p && !vistas.has(p.id)) agregar(p, Array.isArray(item.opciones) ? item.opciones : []);
    }
    for (const p of preguntas) {
      if (!vistas.has(p.id)) agregar(p, []);
    }

    const filas = await this.respuestaRepo.find({ where: { intentoId: intento.id } });
    const respuestas: Record<number, number[]> = {};
    for (const r of filas) {
      const ids = normalizarIds(r.opcionIds);
      if (ids.length) respuestas[r.preguntaId] = ids;
    }

    return {
      success: true,
      data: {
        finalizado: false,
        intentoId: intento.id,
        numero: intento.numero,
        iniciadoEn: intento.iniciadoEn,
        expiraEn: intento.expiraEn,
        ahora: new Date().toISOString(),
        evaluacion: {
          id: ev.id,
          titulo: ev.titulo,
          tipo: ev.tipo === 'FINAL' ? 'FINAL' : 'DIAGNOSTICO',
          instrucciones: ev.instrucciones,
          duracionMin: ev.duracionMin,
        },
        curso: { id: curso?.id ?? ev.cursoId, titulo: curso?.titulo ?? '' },
        preguntas: salida,
        respuestas,
      },
    };
  }

  /** Inicia (o reanuda) un intento. Nunca crea dos intentos EN_CURSO a la vez. */
  async iniciar(userId: number, evaluacionId: number) {
    const ev = await this.evalRepo.findOne({ where: { id: evaluacionId }, relations: ['curso'] });
    if (!ev) throw new NotFoundException('Evaluación no encontrada');
    if (!(await this.tieneAcceso(ev.curso, userId))) {
      throw new BadRequestException('No tienes acceso a esta evaluación');
    }

    const crear = () =>
      this.ds.transaction(async (m): Promise<{ intento?: EvaluacionIntento; error?: string }> => {
        // Serializa las peticiones simultáneas del MISMO estudiante sobre la MISMA
        // evaluación (doble clic / dos pestañas). El UNIQUE(evaluacionId,
        // estudianteId, numero) queda como segunda barrera.
        await m.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [evaluacionId, userId]);

        // FOR SHARE: impide que el admin cambie preguntas/estado a mitad del inicio.
        const actual = await m.findOne(Evaluacion, {
          where: { id: evaluacionId },
          lock: { mode: 'pessimistic_read' },
        });
        if (!actual) return { error: 'Evaluación no encontrada' };

        const intentos = await m.find(EvaluacionIntento, {
          where: { evaluacionId, estudianteId: userId },
          order: { numero: 'ASC' },
        });
        const ahora = new Date();
        const enCurso = intentos.find((i) => i.estado === 'EN_CURSO');
        if (enCurso) {
          if (ahora.getTime() <= new Date(enCurso.expiraEn).getTime()) {
            return { intento: enCurso }; // reanudar: mismo intento, mismo orden
          }
          await this.finalizarEnTx(m, enCurso.id, 'EXPIRADO');
        }

        if (actual.estado === 'CERRADA') return { error: 'Esta evaluación está cerrada' };
        if (actual.estado !== 'PUBLICADA') return { error: 'Esta evaluación no está disponible' };
        if (actual.disponibleDesde && ahora.getTime() < new Date(actual.disponibleDesde).getTime()) {
          return { error: 'Esta evaluación aún no está disponible' };
        }
        if (actual.disponibleHasta && ahora.getTime() > new Date(actual.disponibleHasta).getTime()) {
          return { error: 'El plazo para rendir esta evaluación ya terminó' };
        }
        if (intentos.length >= actual.intentosMax) {
          return { error: 'Ya no tienes intentos disponibles para esta evaluación' };
        }

        const preguntas = await this.cargarPreguntas(evaluacionId, m);
        if (!preguntas.length) return { error: 'Esta evaluación no tiene preguntas' };

        const numero = intentos.reduce((mx, i) => Math.max(mx, i.numero), 0) + 1;
        const nuevo = m.create(EvaluacionIntento, {
          evaluacionId,
          estudianteId: userId,
          numero,
          estado: 'EN_CURSO',
          iniciadoEn: ahora,
          // El tiempo lo fija el servidor; el cliente solo lo muestra.
          expiraEn: new Date(ahora.getTime() + actual.duracionMin * 60_000),
          enviadoEn: null,
          puntaje: null,
          puntajeMax: preguntas.reduce((s, p) => s + (Number(p.puntos) || 0), 0),
          porcentaje: null,
          orden: construirOrden(preguntas, !!actual.aleatorizar),
        });
        return { intento: await m.save(nuevo) };
      });

    let res: { intento?: EvaluacionIntento; error?: string };
    try {
      res = await crear();
    } catch (e: any) {
      // 23505 = unique_violation: otra petición simultánea ya creó el intento.
      if (e?.code === '23505' || e?.driverError?.code === '23505') {
        const existente = await this.intentoRepo.findOne({
          where: { evaluacionId, estudianteId: userId, estado: 'EN_CURSO' },
          order: { numero: 'DESC' },
        });
        if (existente) return this.construirPayload(existente);
        throw new BadRequestException('No se pudo iniciar el intento. Inténtalo de nuevo.');
      }
      throw e;
    }
    if (res.error || !res.intento) {
      throw new BadRequestException(res.error || 'No se pudo iniciar el intento');
    }
    return this.construirPayload(res.intento);
  }

  /** Carga un intento verificando que sea del usuario (404 / 403). */
  private async intentoPropio(userId: number, intentoId: number): Promise<EvaluacionIntento> {
    const intento = await this.intentoRepo.findOne({ where: { id: intentoId } });
    if (!intento) throw new NotFoundException('Intento no encontrado');
    if (intento.estudianteId !== userId) {
      this.logger.warn(`🚫 Usuario ${userId} intentó acceder al intento ${intentoId} de otro estudiante`);
      throw new ForbiddenException('No tienes permiso para acceder a este intento');
    }
    return intento;
  }

  /** GET intento: payload si sigue vigente; si no, lo finaliza y devuelve el resultado. */
  async obtenerIntento(userId: number, intentoId: number) {
    let intento = await this.intentoPropio(userId, intentoId);
    if (intento.estado === 'EN_CURSO' && !this.vencido(intento)) {
      return this.construirPayload(intento);
    }
    if (intento.estado === 'EN_CURSO') {
      intento = (await this.finalizarIntento(intento.id, 'EXPIRADO')) ?? intento;
    }
    return { success: true, data: { finalizado: true, resultado: this.resultadoDe(intento) } };
  }

  /** Autoguardado de una respuesta. `opcionIds: []` borra la respuesta. */
  async guardarRespuesta(userId: number, intentoId: number, dto: GuardarRespuestaDto) {
    const opcionIds = normalizarIds(dto.opcionIds);
    const preguntaId = Number(dto.preguntaId);

    const res = await this.ds.transaction(
      async (m): Promise<{ fin?: 'TIEMPO' | 'ENVIADO'; guardadoEn?: string }> => {
        // FOR UPDATE: serializa con la finalización (cron / enviar / otra pestaña),
        // así nunca se guarda una respuesta en un intento ya calificado.
        const intento = await m.findOne(EvaluacionIntento, {
          where: { id: intentoId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!intento) throw new NotFoundException('Intento no encontrado');
        if (intento.estudianteId !== userId) {
          this.logger.warn(`🚫 Usuario ${userId} intentó responder el intento ${intentoId} de otro estudiante`);
          throw new ForbiddenException('No tienes permiso para acceder a este intento');
        }
        if (intento.estado === 'ENVIADO') return { fin: 'ENVIADO' };
        if (intento.estado !== 'EN_CURSO') return { fin: 'TIEMPO' };
        if (this.vencido(intento)) {
          await this.finalizarEnTx(m, intento.id, 'EXPIRADO');
          return { fin: 'TIEMPO' };
        }

        const pregunta = await m.findOne(EvaluacionPregunta, {
          where: { id: preguntaId, evaluacionId: intento.evaluacionId },
        });
        if (!pregunta) throw new BadRequestException('La pregunta no pertenece a esta evaluación');

        const existente = await m.findOne(EvaluacionRespuesta, {
          where: { intentoId: intento.id, preguntaId },
        });

        if (opcionIds.length === 0) {
          if (existente) await m.delete(EvaluacionRespuesta, existente.id);
          return { guardadoEn: new Date().toISOString() };
        }

        if (pregunta.tipo !== 'MULTIPLE' && opcionIds.length > 1) {
          throw new BadRequestException('Esta pregunta admite una sola opción');
        }
        const opciones = await m.find(EvaluacionOpcion, {
          where: { preguntaId: pregunta.id },
          select: { id: true },
        });
        const validas = new Set(opciones.map((o) => o.id));
        if (!opcionIds.every((id) => validas.has(id))) {
          throw new BadRequestException('Una de las opciones no pertenece a esta pregunta');
        }

        if (existente) {
          existente.opcionIds = opcionIds;
          await m.save(existente);
        } else {
          await m.save(
            m.create(EvaluacionRespuesta, {
              intentoId: intento.id,
              preguntaId,
              opcionIds,
              correcta: null,
              puntos: null,
            }),
          );
        }
        return { guardadoEn: new Date().toISOString() };
      },
    );

    // Se lanza DESPUÉS del commit para que la finalización por tiempo quede guardada.
    if (res.fin === 'TIEMPO') throw new BadRequestException('El tiempo del examen terminó');
    if (res.fin === 'ENVIADO') throw new BadRequestException('Este intento ya fue enviado');
    return { success: true, guardadoEn: res.guardadoEn };
  }

  /** Envía el intento. Idempotente: si ya estaba finalizado devuelve el mismo resultado. */
  async enviar(userId: number, intentoId: number) {
    let intento = await this.intentoPropio(userId, intentoId);
    if (intento.estado === 'EN_CURSO') {
      // Si llega fuera de tiempo (+ gracia) queda como EXPIRADO, calificado con lo guardado.
      intento = (await this.finalizarIntento(intento.id, 'ENVIO')) ?? intento;
    }
    return { success: true, data: { resultado: this.resultadoDe(intento) } };
  }
}
