// src/database/migrations/1764000000000-BaselineSchema.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migración BASE (línea de partida del esquema).
 *
 * Es IDEMPOTENTE: se puede ejecutar sobre
 *   - una BD vacía  → crea el esquema completo;
 *   - la BD de producción existente (creada antes con synchronize y con
 *     init-prod-tablas-nuevas.sql) → solo agrega lo que falte, sin tocar datos.
 *
 * Reemplaza a init-prod-tablas-nuevas.sql. A partir de aquí, cada cambio de
 * entidades debe ir en una migración nueva:  npm run migration:generate
 */
export class BaselineSchema1764000000000 implements MigrationInterface {
  name = 'BaselineSchema1764000000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── Tipos ────────────────────────────────────────────────────────────────
    await q.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                     WHERE t.typname = 'coupon_usage_estado_enum' AND n.nspname = current_schema()) THEN
        CREATE TYPE "coupon_usage_estado_enum" AS ENUM('RESERVADO', 'USADO');
      END IF;
    END $$;`);

    // ── Tablas ───────────────────────────────────────────────────────────────
    await q.query(`CREATE TABLE IF NOT EXISTS "usuarios" ("id" SERIAL NOT NULL, "nombres" character varying NOT NULL, "apellidos" character varying NOT NULL, "correo" character varying NOT NULL, "usuario" character varying NOT NULL, "cedula" character varying NOT NULL, "celular" character varying NOT NULL, "pais" character varying, "foto" character varying, "password" character varying NOT NULL, "rol" character varying NOT NULL DEFAULT 'ESTUDIANTE', "ciudad" character varying, "empresa" character varying, "cargo" character varying, "asignatura" character varying, "emailVerified" boolean NOT NULL DEFAULT false, "emailEstado" character varying, "emailValidadoEn" TIMESTAMP, "suspendido" boolean NOT NULL DEFAULT false, "motivoSuspension" character varying, "suspendidoEn" TIMESTAMP, "emailVerificationToken" character varying, "emailVerificationSentAt" TIMESTAMP, "activo" boolean NOT NULL DEFAULT true, "passwordResetToken" character varying(64), "passwordResetExpiresAt" TIMESTAMP, CONSTRAINT "UQ_63665765c1a778a770c9bd585d3" UNIQUE ("correo"), CONSTRAINT "UQ_0790a401b9d234fa921e9aa1777" UNIQUE ("usuario"), CONSTRAINT "UQ_d0a04a74cdb68388fa196a5ba51" UNIQUE ("cedula"), CONSTRAINT "PK_d7281c63c176e152e4c531594a8" PRIMARY KEY ("id"))`);
    await q.query(`CREATE TABLE IF NOT EXISTS "cursos" ("id" SERIAL NOT NULL, "titulo" character varying NOT NULL, "descripcion" character varying NOT NULL, "imagen" character varying, "tipo" character varying NOT NULL, "cupos" integer NOT NULL DEFAULT '0', "link" character varying, "recursosLink" character varying, "precio" numeric(10,2) NOT NULL DEFAULT '0', "fecha" date, "hora" TIME, "zonaHoraria" character varying NOT NULL DEFAULT 'America/Guayaquil', "profesorId" integer, "activo" boolean NOT NULL DEFAULT true, "finalizado" boolean NOT NULL DEFAULT false, "categoriaId" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_391c5a635ef6b4bd0a46cb75653" PRIMARY KEY ("id"))`);
    await q.query(`CREATE TABLE IF NOT EXISTS "student_courses" ("id" SERIAL NOT NULL, "estudianteId" integer NOT NULL, "cursoId" integer NOT NULL, "pagado" boolean NOT NULL DEFAULT false, "diplomaCodigo" character varying, "diplomaEmitidoEn" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_657695596e142bfc6c38477733b" UNIQUE ("diplomaCodigo"), CONSTRAINT "PK_6c63b56af68884a5a69dde6a32d" PRIMARY KEY ("id"))`);
    await q.query(`CREATE TABLE IF NOT EXISTS "course_coupons" ("id" SERIAL NOT NULL, "cursoId" integer NOT NULL, "codigo" character varying NOT NULL, "tipo" character varying NOT NULL, "usosMaximos" integer NOT NULL, "usosActuales" integer NOT NULL DEFAULT '0', "fechaExpiracion" date, "activo" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_2b9e73aedebc436f09b33458326" UNIQUE ("codigo"), CONSTRAINT "PK_c94a8edc6d037380f10eac4147b" PRIMARY KEY ("id"))`);
    await q.query(`CREATE TABLE IF NOT EXISTS "coupon_usage" ("id" SERIAL NOT NULL, "couponId" integer NOT NULL, "userId" integer NOT NULL, "cursoId" integer NOT NULL, "usadoEn" TIMESTAMP NOT NULL DEFAULT now(), "estado" "coupon_usage_estado_enum" NOT NULL DEFAULT 'RESERVADO', "confirmadoEn" TIMESTAMP, CONSTRAINT "PK_5727b2e426ee3e63c3f5e200e61" PRIMARY KEY ("id"))`);
    await q.query(`CREATE TABLE IF NOT EXISTS "curso_recursos" ("id" SERIAL NOT NULL, "cursoId" integer NOT NULL, "titulo" character varying NOT NULL, "url" character varying, "archivo" character varying, "nombreOriginal" character varying, "mime" character varying, "size" integer DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_7df06a8c1025993687d9da107d9" PRIMARY KEY ("id"))`);
    await q.query(`CREATE TABLE IF NOT EXISTS "categorias" ("id" SERIAL NOT NULL, "nombre" character varying NOT NULL, "descripcion" character varying, "color" character varying, "icono" character varying, "activo" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3886a26251605c571c6b4f861fe" PRIMARY KEY ("id"))`);
    await q.query(`CREATE TABLE IF NOT EXISTS "logs_acceso" ("id" SERIAL NOT NULL, "identificador" character varying NOT NULL, "userId" integer, "nombres" character varying, "rol" character varying, "exito" boolean NOT NULL DEFAULT false, "motivo" character varying NOT NULL, "ip" character varying, "userAgent" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c321eb182fc68d2324a8ed19682" PRIMARY KEY ("id"))`);
    await q.query(`CREATE TABLE IF NOT EXISTS "payment_attempts" ("id" SERIAL NOT NULL, "clientTransactionId" character varying NOT NULL, "cursoId" integer NOT NULL, "userId" integer NOT NULL, "amount" numeric(10,2) NOT NULL, "payphoneId" character varying, "status" character varying NOT NULL DEFAULT 'PENDIENTE', "callbackData" text, "cuponReservaId" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_5321e2182836db0caf757346d30" UNIQUE ("clientTransactionId"), CONSTRAINT "PK_a0d8a67c07a0fef98dfd20214e5" PRIMARY KEY ("id"))`);
    await q.query(`CREATE TABLE IF NOT EXISTS "configuracion" ("clave" character varying(120) NOT NULL, "valor" text, "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_2399565f7d32d0ae082e88dc893" PRIMARY KEY ("clave"))`);
    await q.query(`CREATE TABLE IF NOT EXISTS "campanas" ("id" SERIAL NOT NULL, "nombre" character varying NOT NULL, "asunto" character varying NOT NULL DEFAULT '', "titulo" character varying NOT NULL DEFAULT '', "mensaje" text NOT NULL DEFAULT '', "imagenes" text, "canalEmail" boolean NOT NULL DEFAULT true, "canalWhatsapp" boolean NOT NULL DEFAULT false, "segmento" character varying NOT NULL DEFAULT 'TODOS', "cursoId" integer, "destinatariosManual" text, "estado" character varying NOT NULL DEFAULT 'BORRADOR', "programadaPara" TIMESTAMP, "batchSize" integer, "delayMs" integer, "batchPauseMs" integer, "total" integer NOT NULL DEFAULT '0', "enviadosEmail" integer NOT NULL DEFAULT '0', "enviadosWhatsapp" integer NOT NULL DEFAULT '0', "fallidos" integer NOT NULL DEFAULT '0', "creadoPor" integer, "startedAt" TIMESTAMP, "finishedAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3ea606bfebfb23646dbc654c57d" PRIMARY KEY ("id"))`);
    await q.query(`CREATE TABLE IF NOT EXISTS "campana_destinatarios" ("id" SERIAL NOT NULL, "campaignId" integer NOT NULL, "userId" integer, "nombre" character varying NOT NULL DEFAULT '', "correo" character varying, "celular" character varying, "emailEstado" character varying NOT NULL DEFAULT 'PENDIENTE', "whatsappEstado" character varying NOT NULL DEFAULT 'PENDIENTE', "error" text, "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_d1ff62e226885a99ceea04ceb34" PRIMARY KEY ("id"))`);

    // ── Columnas añadidas con el tiempo (BD que ya existían) ─────────────────
    const columnas: Array<[string, string]> = [
      ['cursos', `"recursosLink" character varying`],
      ['cursos', `"categoriaId" integer`],
      ['cursos', `"finalizado" boolean NOT NULL DEFAULT false`],
      ['cursos', `"zonaHoraria" character varying NOT NULL DEFAULT 'America/Guayaquil'`],
      ['usuarios', `"pais" character varying`],
      ['usuarios', `"foto" character varying`],
      ['usuarios', `"emailEstado" character varying`],
      ['usuarios', `"emailValidadoEn" TIMESTAMP`],
      ['usuarios', `"suspendido" boolean NOT NULL DEFAULT false`],
      ['usuarios', `"motivoSuspension" character varying`],
      ['usuarios', `"suspendidoEn" TIMESTAMP`],
      ['usuarios', `"emailVerificationToken" character varying`],
      ['usuarios', `"emailVerificationSentAt" TIMESTAMP`],
      ['usuarios', `"passwordResetToken" character varying(64)`],
      ['usuarios', `"passwordResetExpiresAt" TIMESTAMP`],
      ['student_courses', `"diplomaCodigo" character varying`],
      ['student_courses', `"diplomaEmitidoEn" TIMESTAMP`],
      ['payment_attempts', `"cuponReservaId" integer`],
      ['campanas', `"titulo" character varying NOT NULL DEFAULT ''`],
    ];
    for (const [tabla, def] of columnas) {
      await q.query(`ALTER TABLE "${tabla}" ADD COLUMN IF NOT EXISTS ${def}`);
    }

    // ── Índices ──────────────────────────────────────────────────────────────
    await this.indexIfMissing(q, 'coupon_usage', ['couponId', 'userId'], `CREATE UNIQUE INDEX "IDX_2751736a44377fbcbf2fd3f8f6" ON "coupon_usage" ("couponId", "userId")`);
    await this.indexIfMissing(q, 'logs_acceso', ['identificador'], `CREATE INDEX "IDX_8dbf71ec93aa76dddd31122e87" ON "logs_acceso" ("identificador")`);
    await this.indexIfMissing(q, 'payment_attempts', ['clientTransactionId'], `CREATE INDEX "IDX_5321e2182836db0caf757346d3" ON "payment_attempts" ("clientTransactionId")`);
    await this.indexIfMissing(q, 'campana_destinatarios', ['campaignId'], `CREATE INDEX "IDX_133f4d4021eae364abfaefa74f" ON "campana_destinatarios" ("campaignId")`);

    // ── Llaves foráneas (solo si la columna aún no tiene una) ────────────────
    await this.fkIfMissing(q, 'coupon_usage', 'userId', `ALTER TABLE "coupon_usage" ADD CONSTRAINT "FK_302670923e49b67d7f4e9772f64" FOREIGN KEY ("userId") REFERENCES "usuarios"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await this.fkIfMissing(q, 'coupon_usage', 'couponId', `ALTER TABLE "coupon_usage" ADD CONSTRAINT "FK_18b10b5df91ce11abe764e6edda" FOREIGN KEY ("couponId") REFERENCES "course_coupons"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await this.fkIfMissing(q, 'course_coupons', 'cursoId', `ALTER TABLE "course_coupons" ADD CONSTRAINT "FK_4d0cf25701095282d7f967ce701" FOREIGN KEY ("cursoId") REFERENCES "cursos"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await this.fkIfMissing(q, 'cursos', 'profesorId', `ALTER TABLE "cursos" ADD CONSTRAINT "FK_d1603d55af5c55310dd8ca1cc01" FOREIGN KEY ("profesorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    await this.fkIfMissing(q, 'student_courses', 'estudianteId', `ALTER TABLE "student_courses" ADD CONSTRAINT "FK_61e2b68179de8ef55a43ba58953" FOREIGN KEY ("estudianteId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await this.fkIfMissing(q, 'student_courses', 'cursoId', `ALTER TABLE "student_courses" ADD CONSTRAINT "FK_e2592936b0c6e2ca29d6925e755" FOREIGN KEY ("cursoId") REFERENCES "cursos"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await this.fkIfMissing(q, 'curso_recursos', 'cursoId', `ALTER TABLE "curso_recursos" ADD CONSTRAINT "FK_ca3f9eac2cb62e86bf06a693b7a" FOREIGN KEY ("cursoId") REFERENCES "cursos"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await this.fkIfMissing(q, 'campana_destinatarios', 'campaignId', `ALTER TABLE "campana_destinatarios" ADD CONSTRAINT "FK_133f4d4021eae364abfaefa74f9" FOREIGN KEY ("campaignId") REFERENCES "campanas"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
  }

  public async down(): Promise<void> {
    // Migración base: revertirla borraría toda la BD. Intencionalmente no hace nada.
  }

  /** Crea el índice si no existe ya uno sobre exactamente esas columnas (con cualquier nombre). */
  private async indexIfMissing(q: QueryRunner, tabla: string, cols: string[], sql: string) {
    const rows = await q.query(
      `SELECT 1 FROM pg_index i
         JOIN pg_class t ON t.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE t.relname = $1 AND n.nspname = current_schema()
          AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
                 FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum) = $2::text[]`,
      [tabla, cols],
    );
    if (rows.length === 0) await this.tolerant(q, sql);
  }

  /**
   * Ejecuta DDL de restricciones sin tumbar el arranque si hay datos que la
   * violan (filas huérfanas/duplicadas en una BD antigua): deja un WARNING en
   * el log de Postgres y continúa. El bloque EXCEPTION usa un savepoint, así
   * que la transacción de la migración no se aborta.
   */
  private async tolerant(q: QueryRunner, sql: string) {
    await q.query(`DO $$ BEGIN
      ${sql};
    EXCEPTION WHEN foreign_key_violation OR unique_violation THEN
      RAISE WARNING 'BaselineSchema: se omitió por datos inconsistentes: %', SQLERRM;
    END $$;`);
  }

  /** Crea la FK si la columna todavía no tiene ninguna (con cualquier nombre). */
  private async fkIfMissing(q: QueryRunner, tabla: string, columna: string, sql: string) {
    const rows = await q.query(
      `SELECT 1 FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND t.relname = $1 AND a.attname = $2 AND n.nspname = current_schema()`,
      [tabla, columna],
    );
    if (rows.length === 0) await this.tolerant(q, sql);
  }
}
