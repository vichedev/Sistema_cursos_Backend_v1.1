/**
 * Utilidades para manejar fechas "solo día" (YYYY-MM-DD) sin que la zona horaria
 * del servidor las desplace un día.
 *
 * Problema que resuelve: `new Date('2026-05-12')` se interpreta como medianoche UTC.
 * Al guardarse en una columna `date` de Postgres, TypeORM usa los componentes LOCALES
 * del Date (`getDate()`...), por lo que en zonas horarias detrás de UTC (ej. UTC-5,
 * Ecuador) la fecha se almacena como el día anterior (2026-05-11).
 *
 * La solución es trabajar SIEMPRE con cadenas 'YYYY-MM-DD' y nunca convertirlas a Date.
 */

/** Normaliza cualquier entrada de fecha (string ISO, 'YYYY-MM-DD' o Date) a 'YYYY-MM-DD'. */
export function toDateOnlyString(input: unknown): string | null {
  if (input === null || input === undefined || input === '') return null;

  if (input instanceof Date) {
    if (isNaN(input.getTime())) return null;
    // Las columnas `date` de Postgres se hidratan como Date a medianoche LOCAL,
    // así que usamos los componentes locales para no desplazar el día.
    const y = input.getFullYear();
    const m = String(input.getMonth() + 1).padStart(2, '0');
    const d = String(input.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const str = String(input).trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;

  const parsed = new Date(str);
  if (isNaN(parsed.getTime())) return null;
  const y = parsed.getUTCFullYear();
  const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const d = String(parsed.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Fecha local de hoy en formato 'YYYY-MM-DD'. */
export function todayLocalDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Indica si una fecha de expiración "solo día" ya pasó.
 * La expiración es INCLUSIVA: el cupón sigue válido durante todo su día de expiración.
 */
export function isDateOnlyExpired(fechaExpiracion: unknown): boolean {
  const exp = toDateOnlyString(fechaExpiracion);
  if (!exp) return false; // sin fecha => nunca expira
  return todayLocalDateString() > exp;
}

/** Transformer de TypeORM para columnas `date`: garantiza 'YYYY-MM-DD' en lectura y escritura. */
export const dateOnlyTransformer = {
  to: (value: unknown): string | null => toDateOnlyString(value),
  from: (value: unknown): string | null => toDateOnlyString(value),
};
