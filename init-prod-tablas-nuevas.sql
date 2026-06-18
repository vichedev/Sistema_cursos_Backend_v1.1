-- Tablas nuevas para Configuración, WhatsApp y Publicidad/Campañas
-- Generado desde el esquema real de TypeORM (BD de desarrollo).
-- Seguro de ejecutar: usa CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "configuracion" (
  "clave" varchar(120) NOT NULL,
  "valor" text,
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("clave")
);

CREATE TABLE IF NOT EXISTS "campanas" (
  "id" SERIAL NOT NULL,
  "nombre" varchar NOT NULL,
  "asunto" varchar NOT NULL DEFAULT ''::character varying,
  "mensaje" text NOT NULL DEFAULT ''::text,
  "imagenes" text,
  "canalEmail" boolean NOT NULL DEFAULT true,
  "canalWhatsapp" boolean NOT NULL DEFAULT false,
  "segmento" varchar NOT NULL DEFAULT 'TODOS'::character varying,
  "cursoId" integer,
  "destinatariosManual" text,
  "estado" varchar NOT NULL DEFAULT 'BORRADOR'::character varying,
  "programadaPara" timestamp,
  "batchSize" integer,
  "delayMs" integer,
  "batchPauseMs" integer,
  "total" integer NOT NULL DEFAULT 0,
  "enviadosEmail" integer NOT NULL DEFAULT 0,
  "enviadosWhatsapp" integer NOT NULL DEFAULT 0,
  "fallidos" integer NOT NULL DEFAULT 0,
  "creadoPor" integer,
  "startedAt" timestamp,
  "finishedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  "titulo" varchar NOT NULL DEFAULT ''::character varying,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "campana_destinatarios" (
  "id" SERIAL NOT NULL,
  "campaignId" integer NOT NULL,
  "userId" integer,
  "nombre" varchar NOT NULL DEFAULT ''::character varying,
  "correo" varchar,
  "celular" varchar,
  "emailEstado" varchar NOT NULL DEFAULT 'PENDIENTE'::character varying,
  "whatsappEstado" varchar NOT NULL DEFAULT 'PENDIENTE'::character varying,
  "error" text,
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "IDX_campana_dest_campaignId" ON "campana_destinatarios" ("campaignId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='FK_campana_dest_campaign') THEN
    ALTER TABLE "campana_destinatarios"
      ADD CONSTRAINT "FK_campana_dest_campaign"
      FOREIGN KEY ("campaignId") REFERENCES "campanas"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Categorías de cursos, Material didáctico (recursos) y Logs de acceso
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "categorias" (
  "id" SERIAL NOT NULL,
  "nombre" varchar NOT NULL,
  "descripcion" varchar,
  "color" varchar,
  "icono" varchar,
  "activo" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

-- Columna de categoría en cursos
ALTER TABLE "cursos" ADD COLUMN IF NOT EXISTS "categoriaId" integer;

-- Finalización manual del curso (la decide el admin, no la fecha)
ALTER TABLE "cursos" ADD COLUMN IF NOT EXISTS "finalizado" boolean NOT NULL DEFAULT false;

-- Zona horaria de referencia del curso (IANA)
ALTER TABLE "cursos" ADD COLUMN IF NOT EXISTS "zonaHoraria" varchar NOT NULL DEFAULT 'America/Guayaquil';

-- Foto de perfil del usuario
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "foto" varchar;

-- Validación de existencia del correo (valido | riesgoso | invalido)
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "emailEstado" varchar;
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "emailValidadoEn" timestamp;

-- Suspensión de cuenta (bloquea login hasta revalidar con soporte)
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "suspendido" boolean NOT NULL DEFAULT false;
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "motivoSuspension" varchar;
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "suspendidoEn" timestamp;

CREATE TABLE IF NOT EXISTS "curso_recursos" (
  "id" SERIAL NOT NULL,
  "cursoId" integer NOT NULL,
  "titulo" varchar NOT NULL,
  "url" varchar,
  "archivo" varchar,
  "nombreOriginal" varchar,
  "mime" varchar,
  "size" integer DEFAULT 0,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='FK_curso_recursos_curso') THEN
    ALTER TABLE "curso_recursos"
      ADD CONSTRAINT "FK_curso_recursos_curso"
      FOREIGN KEY ("cursoId") REFERENCES "cursos"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "logs_acceso" (
  "id" SERIAL NOT NULL,
  "identificador" varchar NOT NULL,
  "userId" integer,
  "nombres" varchar,
  "rol" varchar,
  "exito" boolean NOT NULL DEFAULT false,
  "motivo" varchar NOT NULL,
  "ip" varchar,
  "userAgent" varchar,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "IDX_logs_acceso_identificador" ON "logs_acceso" ("identificador");
