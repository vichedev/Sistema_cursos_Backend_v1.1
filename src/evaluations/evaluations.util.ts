// src/evaluations/evaluations.util.ts
// Funciones puras del módulo de evaluaciones (calificación, validación, barajado).
import { randomInt } from 'crypto';
import { OrdenIntento } from './evaluacion-intento.entity';

/** Margen de gracia (latencia de red) tras `expiraEn` para guardar/enviar. */
export const GRACIA_MS = 30_000;

export const TIPOS_PREGUNTA = ['UNICA', 'MULTIPLE', 'VF'] as const;

/** Tipos de evaluación: diagnóstico inicial o examen final del curso. */
export const TIPOS_EVALUACION = ['DIAGNOSTICO', 'FINAL'] as const;

export const LIMITES = {
  titulo: 150,
  instrucciones: 3000,
  enunciado: 2000,
  opcion: 500,
  maxPreguntas: 200,
  maxOpciones: 8,
  minOpciones: 2,
  puntosMin: 1,
  puntosMax: 100,
};

export interface OpcionLike {
  id?: number;
  texto: string;
  esCorrecta: boolean;
  orden?: number;
}

export interface PreguntaLike {
  id?: number;
  enunciado: string;
  tipo: string;
  puntos: number;
  orden?: number;
  opciones: OpcionLike[];
}

export const redondear2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Baraja una copia del arreglo (Fisher–Yates) con aleatoriedad criptográfica. */
export function barajar<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Orden con el que se presentará un intento. Si `aleatorizar`, se barajan las
 * preguntas y las opciones (las de Verdadero/Falso conservan su orden natural).
 * Se persiste en el intento para que al reanudar se vea exactamente igual.
 */
export function construirOrden(preguntas: PreguntaLike[], aleatorizar: boolean): OrdenIntento {
  const base = aleatorizar ? barajar(preguntas) : preguntas;
  return {
    preguntas: base.map((p) => {
      const ops = aleatorizar && p.tipo !== 'VF' ? barajar(p.opciones) : p.opciones;
      return { id: p.id as number, opciones: ops.map((o) => o.id as number) };
    }),
  };
}

/** Normaliza una lista de ids elegidos: enteros positivos, sin repetidos. */
export function normalizarIds(ids: unknown): number[] {
  if (!Array.isArray(ids)) return [];
  const out = new Set<number>();
  for (const x of ids) {
    const n = Number(x);
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return [...out];
}

export interface ResultadoPregunta {
  preguntaId: number;
  respondida: boolean;
  correcta: boolean;
  puntos: number;
}

export interface ResultadoCalificacion {
  puntaje: number;
  puntajeMax: number;
  porcentaje: number;
  porPregunta: ResultadoPregunta[];
}

/**
 * Calificación (SOLO servidor).
 *  - UNICA / VF: correcta si eligió exactamente la opción correcta.
 *  - MULTIPLE: todo o nada (conjunto elegido == conjunto correcto).
 * Solo cuentan las opciones que realmente pertenecen a la pregunta.
 */
export function calificar(
  preguntas: PreguntaLike[],
  respuestas: Map<number, number[]>,
): ResultadoCalificacion {
  let puntaje = 0;
  let puntajeMax = 0;
  const porPregunta: ResultadoPregunta[] = [];

  for (const p of preguntas) {
    const puntos = Number(p.puntos) || 0;
    puntajeMax += puntos;

    const validas = new Set(p.opciones.map((o) => o.id as number));
    const correctas = p.opciones.filter((o) => o.esCorrecta).map((o) => o.id as number);
    const elegidasRaw = normalizarIds(respuestas.get(p.id as number) ?? []);
    const elegidas = elegidasRaw.filter((id) => validas.has(id));

    let correcta = false;
    // Una respuesta con ids ajenos a la pregunta nunca es correcta.
    if (elegidas.length === elegidasRaw.length && elegidas.length > 0 && correctas.length > 0) {
      if (p.tipo === 'MULTIPLE') {
        const set = new Set(elegidas);
        correcta = elegidas.length === correctas.length && correctas.every((id) => set.has(id));
      } else {
        correcta = elegidas.length === 1 && correctas.length === 1 && elegidas[0] === correctas[0];
      }
    }

    const obtenidos = correcta ? puntos : 0;
    puntaje += obtenidos;
    porPregunta.push({
      preguntaId: p.id as number,
      respondida: elegidasRaw.length > 0,
      correcta,
      puntos: obtenidos,
    });
  }

  const porcentaje = puntajeMax > 0 ? redondear2((puntaje / puntajeMax) * 100) : 0;
  return { puntaje: redondear2(puntaje), puntajeMax: redondear2(puntajeMax), porcentaje, porPregunta };
}

/** Validación COMPLETA exigida para publicar. Devuelve la lista de errores (vacía = ok). */
export function validarParaPublicar(preguntas: PreguntaLike[]): string[] {
  const errores: string[] = [];
  if (!preguntas || preguntas.length === 0) {
    return ['La evaluación debe tener al menos una pregunta'];
  }
  if (preguntas.length > LIMITES.maxPreguntas) {
    errores.push(`La evaluación no puede tener más de ${LIMITES.maxPreguntas} preguntas`);
  }

  preguntas.forEach((p, i) => {
    const n = `Pregunta ${i + 1}`;
    const enunciado = String(p.enunciado ?? '').trim();
    if (!enunciado) errores.push(`${n}: el enunciado está vacío`);
    if (enunciado.length > LIMITES.enunciado) {
      errores.push(`${n}: el enunciado supera los ${LIMITES.enunciado} caracteres`);
    }

    const puntos = Number(p.puntos);
    if (!Number.isInteger(puntos) || puntos < LIMITES.puntosMin || puntos > LIMITES.puntosMax) {
      errores.push(`${n}: los puntos deben ser un entero entre ${LIMITES.puntosMin} y ${LIMITES.puntosMax}`);
    }

    const opciones = p.opciones || [];
    const correctas = opciones.filter((o) => o.esCorrecta === true).length;

    if (!(TIPOS_PREGUNTA as readonly string[]).includes(p.tipo)) {
      errores.push(`${n}: tipo de pregunta no válido`);
      return;
    }

    if (opciones.some((o) => String(o.texto ?? '').length > LIMITES.opcion)) {
      errores.push(`${n}: una opción supera los ${LIMITES.opcion} caracteres`);
    }

    if (p.tipo === 'VF') {
      const textos = opciones.map((o) => String(o.texto ?? '').trim().toLowerCase());
      if (opciones.length !== 2 || textos[0] !== 'verdadero' || textos[1] !== 'falso') {
        errores.push(`${n}: una pregunta de Verdadero/Falso debe tener exactamente las opciones "Verdadero" y "Falso"`);
      }
      if (correctas !== 1) errores.push(`${n}: debe tener exactamente 1 opción correcta`);
      return;
    }

    if (opciones.length < LIMITES.minOpciones || opciones.length > LIMITES.maxOpciones) {
      errores.push(`${n}: debe tener entre ${LIMITES.minOpciones} y ${LIMITES.maxOpciones} opciones`);
    }
    if (opciones.some((o) => !String(o.texto ?? '').trim())) {
      errores.push(`${n}: todas las opciones deben tener texto`);
    }
    if (p.tipo === 'UNICA' && correctas !== 1) {
      errores.push(`${n}: debe tener exactamente 1 opción correcta`);
    }
    if (p.tipo === 'MULTIPLE' && correctas < 1) {
      errores.push(`${n}: debe tener al menos 1 opción correcta`);
    }
  });

  return errores;
}

/** Resume una lista de errores en un único mensaje legible. */
export function resumirErrores(errores: string[], max = 5): string {
  const primeros = errores.slice(0, max).join('. ');
  const resto = errores.length - max;
  return resto > 0 ? `${primeros}. (y ${resto} error(es) más)` : primeros;
}

// ── Elegibilidad de notificaciones (mismas reglas que CoursesService) ────────
interface Notificable {
  correo?: string | null;
  celular?: string | null;
  emailVerified?: boolean;
  suspendido?: boolean;
  emailEstado?: string | null;
  activo?: boolean;
}

/** Correo: solo verificado, no suspendido, con correo no marcado como inválido. */
export const puedeRecibirCorreo = (e: Notificable) =>
  e.activo !== false && !!e.correo && !!e.emailVerified && !e.suspendido && e.emailEstado !== 'invalido';

/** WhatsApp: con celular y no suspendido. */
export const puedeRecibirWhatsapp = (e: Notificable) =>
  e.activo !== false && !!e.celular && !e.suspendido;

export const escapeHtml = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
