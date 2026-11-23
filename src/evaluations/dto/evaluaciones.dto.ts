// src/evaluations/dto/evaluaciones.dto.ts
// DTOs del módulo de evaluaciones. El ValidationPipe global (whitelist +
// forbidNonWhitelisted) rechaza cualquier propiedad no declarada aquí.
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty,
  IsOptional, IsString, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { ToBoolean } from '../../common/to-boolean.decorator';
import { LIMITES, TIPOS_EVALUACION, TIPOS_PREGUNTA } from '../evaluations.util';

/** "" → null (un input de fecha vacío significa "sin fecha"). */
const VacioANull = () => Transform(({ value }) => (value === '' ? null : value));
const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

// ── Evaluación ───────────────────────────────────────────────────────────────
export class CrearEvaluacionDto {
  @IsInt()
  @Min(1)
  cursoId: number;

  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'El título es obligatorio' })
  @MaxLength(LIMITES.titulo, { message: `El título no puede superar los ${LIMITES.titulo} caracteres` })
  titulo: string;

  @IsOptional()
  @IsString()
  @MaxLength(LIMITES.instrucciones, {
    message: `Las instrucciones no pueden superar los ${LIMITES.instrucciones} caracteres`,
  })
  instrucciones?: string;

  /** Solo al crear: el tipo NO es editable después (no existe en ActualizarEvaluacionDto). */
  @IsOptional()
  @IsIn(TIPOS_EVALUACION as unknown as string[], { message: 'tipo debe ser DIAGNOSTICO o FINAL' })
  tipo?: string;

  @IsInt({ message: 'La duración debe ser un número entero de minutos' })
  @Min(1, { message: 'La duración mínima es 1 minuto' })
  @Max(300, { message: 'La duración máxima es 300 minutos' })
  duracionMin: number;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'Debe permitir al menos 1 intento' })
  @Max(10, { message: 'Máximo 10 intentos' })
  intentosMax?: number;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  aleatorizar?: boolean;

  @VacioANull()
  @IsOptional()
  @IsDateString({}, { message: 'disponibleDesde debe ser una fecha ISO válida' })
  disponibleDesde?: string | null;

  @VacioANull()
  @IsOptional()
  @IsDateString({}, { message: 'disponibleHasta debe ser una fecha ISO válida' })
  disponibleHasta?: string | null;
}

export class ActualizarEvaluacionDto {
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'El título es obligatorio' })
  @MaxLength(LIMITES.titulo, { message: `El título no puede superar los ${LIMITES.titulo} caracteres` })
  titulo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LIMITES.instrucciones, {
    message: `Las instrucciones no pueden superar los ${LIMITES.instrucciones} caracteres`,
  })
  instrucciones?: string;

  @IsOptional()
  @IsInt({ message: 'La duración debe ser un número entero de minutos' })
  @Min(1, { message: 'La duración mínima es 1 minuto' })
  @Max(300, { message: 'La duración máxima es 300 minutos' })
  duracionMin?: number;

  @IsOptional()
  @IsInt()
  @Min(1, { message: 'Debe permitir al menos 1 intento' })
  @Max(10, { message: 'Máximo 10 intentos' })
  intentosMax?: number;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  aleatorizar?: boolean;

  @VacioANull()
  @IsOptional()
  @IsDateString({}, { message: 'disponibleDesde debe ser una fecha ISO válida' })
  disponibleDesde?: string | null;

  @VacioANull()
  @IsOptional()
  @IsDateString({}, { message: 'disponibleHasta debe ser una fecha ISO válida' })
  disponibleHasta?: string | null;
}

// ── Preguntas ────────────────────────────────────────────────────────────────
export class OpcionDto {
  /** Se acepta (y se ignora) para poder reenviar lo que devolvió el GET. */
  @IsOptional()
  id?: any;

  @IsOptional()
  orden?: any;

  @IsString()
  @MaxLength(LIMITES.opcion, { message: `Cada opción admite hasta ${LIMITES.opcion} caracteres` })
  texto: string;

  @ToBoolean()
  @IsBoolean()
  esCorrecta: boolean;
}

export class PreguntaDto {
  /** Se acepta (y se ignora) para poder reenviar lo que devolvió el GET. */
  @IsOptional()
  id?: any;

  @IsOptional()
  orden?: any;

  @IsString()
  @MaxLength(LIMITES.enunciado, { message: `El enunciado admite hasta ${LIMITES.enunciado} caracteres` })
  enunciado: string;

  @IsIn(TIPOS_PREGUNTA as unknown as string[], { message: 'tipo debe ser UNICA, MULTIPLE o VF' })
  tipo: string;

  @IsInt({ message: 'Los puntos deben ser un número entero' })
  @Min(LIMITES.puntosMin, { message: `Los puntos mínimos son ${LIMITES.puntosMin}` })
  @Max(LIMITES.puntosMax, { message: `Los puntos máximos son ${LIMITES.puntosMax}` })
  puntos: number;

  @IsArray()
  @ArrayMaxSize(LIMITES.maxOpciones, { message: `Máximo ${LIMITES.maxOpciones} opciones por pregunta` })
  @ValidateNested({ each: true })
  @Type(() => OpcionDto)
  opciones: OpcionDto[];
}

export class GuardarPreguntasDto {
  @IsArray()
  @ArrayMaxSize(LIMITES.maxPreguntas, { message: `Máximo ${LIMITES.maxPreguntas} preguntas` })
  @ValidateNested({ each: true })
  @Type(() => PreguntaDto)
  preguntas: PreguntaDto[];
}

export class PublicarEvaluacionDto {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  notificarCorreo?: boolean;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  notificarWhatsapp?: boolean;
}

// ── Estudiante ───────────────────────────────────────────────────────────────
export class GuardarRespuestaDto {
  @IsInt()
  @Min(1)
  preguntaId: number;

  @IsArray()
  @ArrayMaxSize(LIMITES.maxOpciones)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  opcionIds: number[];
}
