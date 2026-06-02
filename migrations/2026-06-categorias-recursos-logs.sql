-- ─────────────────────────────────────────────────────────────────────────────
-- Migración manual para PRODUCCIÓN (synchronize está apagado con NODE_ENV=production).
-- Crea las tablas/columnas nuevas: categorías, material didáctico (recursos),
-- logs de acceso y la columna de categoría en cursos.
-- Es IDEMPOTENTE: se puede ejecutar varias veces sin error.
--
-- Cómo ejecutarlo (PostgreSQL):
--   psql -h <DB_HOST> -U <DB_USER> -d <DB_NAME> -f 2026-06-categorias-recursos-logs.sql
-- (o pégalo en tu cliente de BD: pgAdmin, DBeaver, etc.)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Categorías de cursos
CREATE TABLE IF NOT EXISTS categorias (
  id SERIAL PRIMARY KEY,
  nombre varchar NOT NULL,
  descripcion varchar,
  color varchar,
  icono varchar,
  activo boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

-- 2) Columna de categoría en cursos
ALTER TABLE cursos ADD COLUMN IF NOT EXISTS "categoriaId" integer;

-- 3) Material didáctico (recursos del curso, ligado al curso con borrado en cascada)
CREATE TABLE IF NOT EXISTS curso_recursos (
  id SERIAL PRIMARY KEY,
  "cursoId" integer NOT NULL,
  titulo varchar NOT NULL,
  url varchar,
  archivo varchar,
  "nombreOriginal" varchar,
  mime varchar,
  size integer DEFAULT 0,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT fk_curso_recursos_curso FOREIGN KEY ("cursoId")
    REFERENCES cursos(id) ON DELETE CASCADE
);

-- 4) Logs de acceso (monitoreo de inicios de sesión)
CREATE TABLE IF NOT EXISTS logs_acceso (
  id SERIAL PRIMARY KEY,
  identificador varchar NOT NULL,
  "userId" integer,
  nombres varchar,
  rol varchar,
  exito boolean NOT NULL DEFAULT false,
  motivo varchar NOT NULL,
  ip varchar,
  "userAgent" varchar,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_logs_acceso_identificador ON logs_acceso (identificador);
