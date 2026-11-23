// src/common/to-boolean.decorator.ts
import { Transform } from 'class-transformer';

/**
 * Convierte de forma ESTRICTA un campo booleano de un DTO.
 *
 * El ValidationPipe global usa `enableImplicitConversion`, que convierte con
 * Boolean(valor): el string "false" terminaría siendo `true`. Este decorador
 * lee el valor ORIGINAL del body y solo acepta true/false (o "true"/"false");
 * cualquier otra cosa se deja tal cual para que @IsBoolean() la rechace.
 */
export function ToBoolean(): PropertyDecorator {
  return Transform(({ obj, key }) => {
    const raw = obj?.[key];
    if (raw === true || raw === 'true') return true;
    if (raw === false || raw === 'false') return false;
    return raw;
  });
}
