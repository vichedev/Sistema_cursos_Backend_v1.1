// src/database/migrations/1764100000000-PrivateCoursesAndEvaluations.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cursos privados + evaluaciones de diagnóstico.
 *
 *  - cursos.privado
 *  - curso_asignaciones            (estudiantes asignados a un curso privado)
 *  - evaluaciones / evaluacion_preguntas / evaluacion_opciones
 *  - evaluacion_intentos / evaluacion_respuestas
 *
 * Es IDEMPOTENTE (mismo estilo que BaselineSchema): en desarrollo las tablas
 * pueden existir ya (synchronize) y en producción se ejecuta sola al arrancar.
 * El DDL coincide exactamente con el que TypeORM espera de las entidades.
 */
export class PrivateCoursesAndEvaluations1764100000000 implements MigrationInterface {
  name = 'PrivateCoursesAndEvaluations1764100000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── Columna nueva en cursos ──────────────────────────────────────────────
    await q.query(`ALTER TABLE "cursos" ADD COLUMN IF NOT EXISTS "privado" boolean NOT NULL DEFAULT false`);

    // ── Tablas ───────────────────────────────────────────────────────────────
    await q.query(`CREATE TABLE IF NOT EXISTS "curso_asignaciones" ("id" SERIAL NOT NULL, "cursoId" integer NOT NULL, "estudianteId" integer NOT NULL, "asignadoPor" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_78743f88539e971f5280537b911" UNIQUE ("cursoId", "estudianteId"), CONSTRAINT "PK_fa7cabd5ff3e570b839a70a6ae5" PRIMARY KEY ("id"))`);
    await q.query(`CREATE TABLE IF NOT EXISTS "evaluaciones" ("id" SERIAL NOT NULL, "cursoId" integer NOT NULL, "titulo" character varying NOT NULL, "instrucciones" text NOT NULL DEFAULT '', "tipo" character varying NOT NULL DEFAULT 'DIAGNOSTICO', "duracionMin" integer NOT NULL, "intentosMax" integer NOT NULL DEFAULT '1', "aleatorizar" boolean NOT NULL DEFAULT true, "estado" character varying NOT NULL DEFAULT 'BORRADOR', "disponibleDesde" TIMESTAMP, "disponibleHasta" TIMESTAMP, "publicadaEn" TIMESTAMP, "creadoPor" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3b157bcce651495e675cdf96a14" PRIMARY KEY ("id"))`);
    await q.query(`CREATE TABLE IF NOT EXISTS "evaluacion_preguntas" ("id" SERIAL NOT NULL, "evaluacionId" integer NOT NULL, "enunciado" text NOT NULL, "tipo" character varying NOT NULL, "puntos" integer NOT NULL DEFAULT '1', "orden" integer NOT NULL, CONSTRAINT "PK_5ab180ae6b51acd107eaf13b866" PRIMARY KEY ("id"))`);
    await q.query(`CREATE TABLE IF NOT EXISTS "evaluacion_opciones" ("id" SERIAL NOT NULL, "preguntaId" integer NOT NULL, "texto" text NOT NULL, "esCorrecta" boolean NOT NULL DEFAULT false, "orden" integer NOT NULL, CONSTRAINT "PK_86f4507bd179db3fc69e7436411" PRIMARY KEY ("id"))`);
    await q.query(`CREATE TABLE IF NOT EXISTS "evaluacion_intentos" ("id" SERIAL NOT NULL, "evaluacionId" integer NOT NULL, "estudianteId" integer NOT NULL, "numero" integer NOT NULL, "estado" character varying NOT NULL, "iniciadoEn" TIMESTAMP NOT NULL, "expiraEn" TIMESTAMP NOT NULL, "enviadoEn" TIMESTAMP, "puntaje" numeric(8,2), "puntajeMax" numeric(8,2) NOT NULL, "porcentaje" numeric(5,2), "orden" text NOT NULL, CONSTRAINT "UQ_d4304ac71d7396cc7495176880a" UNIQUE ("evaluacionId", "estudianteId", "numero"), CONSTRAINT "PK_2577f994e76f76c85e67e01ce12" PRIMARY KEY ("id"))`);
    await q.query(`CREATE TABLE IF NOT EXISTS "evaluacion_respuestas" ("id" SERIAL NOT NULL, "intentoId" integer NOT NULL, "preguntaId" integer NOT NULL, "opcionIds" text NOT NULL, "correcta" boolean, "puntos" numeric(8,2), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_9c67b97f1444f348449934f8570" UNIQUE ("intentoId", "preguntaId"), CONSTRAINT "PK_f5b587885d8bc4cf257f760e05d" PRIMARY KEY ("id"))`);

    // ── Índices ──────────────────────────────────────────────────────────────
    await this.indexIfMissing(q, 'evaluaciones', ['cursoId'], `CREATE INDEX "IDX_b2cd50e4830736927591758f8e" ON "evaluaciones" ("cursoId")`);
    await this.indexIfMissing(q, 'evaluacion_preguntas', ['evaluacionId'], `CREATE INDEX "IDX_74d3e8ddeac8ecd9c999fb0c20" ON "evaluacion_preguntas" ("evaluacionId")`);
    await this.indexIfMissing(q, 'evaluacion_opciones', ['preguntaId'], `CREATE INDEX "IDX_340405cc23f0fea309063701d2" ON "evaluacion_opciones" ("preguntaId")`);
    await this.indexIfMissing(q, 'evaluacion_intentos', ['estudianteId'], `CREATE INDEX "IDX_a78aeae97a03c4f8ad497760f2" ON "evaluacion_intentos" ("estudianteId")`);

    // ── Llaves foráneas (solo si la columna aún no tiene una) ────────────────
    await this.fkIfMissing(q, 'curso_asignaciones', 'cursoId', `ALTER TABLE "curso_asignaciones" ADD CONSTRAINT "FK_ebb94cb456923d54ae647189e24" FOREIGN KEY ("cursoId") REFERENCES "cursos"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await this.fkIfMissing(q, 'curso_asignaciones', 'estudianteId', `ALTER TABLE "curso_asignaciones" ADD CONSTRAINT "FK_4cf0864589645ed9855073d329b" FOREIGN KEY ("estudianteId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await this.fkIfMissing(q, 'evaluaciones', 'cursoId', `ALTER TABLE "evaluaciones" ADD CONSTRAINT "FK_b2cd50e4830736927591758f8e7" FOREIGN KEY ("cursoId") REFERENCES "cursos"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await this.fkIfMissing(q, 'evaluacion_preguntas', 'evaluacionId', `ALTER TABLE "evaluacion_preguntas" ADD CONSTRAINT "FK_74d3e8ddeac8ecd9c999fb0c202" FOREIGN KEY ("evaluacionId") REFERENCES "evaluaciones"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await this.fkIfMissing(q, 'evaluacion_opciones', 'preguntaId', `ALTER TABLE "evaluacion_opciones" ADD CONSTRAINT "FK_340405cc23f0fea309063701d2f" FOREIGN KEY ("preguntaId") REFERENCES "evaluacion_preguntas"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await this.fkIfMissing(q, 'evaluacion_intentos', 'evaluacionId', `ALTER TABLE "evaluacion_intentos" ADD CONSTRAINT "FK_b6f7bda669d40bcb892e02aeb16" FOREIGN KEY ("evaluacionId") REFERENCES "evaluaciones"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await this.fkIfMissing(q, 'evaluacion_intentos', 'estudianteId', `ALTER TABLE "evaluacion_intentos" ADD CONSTRAINT "FK_a78aeae97a03c4f8ad497760f2e" FOREIGN KEY ("estudianteId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await this.fkIfMissing(q, 'evaluacion_respuestas', 'intentoId', `ALTER TABLE "evaluacion_respuestas" ADD CONSTRAINT "FK_5a44dec94d619c0816caab978e9" FOREIGN KEY ("intentoId") REFERENCES "evaluacion_intentos"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "evaluacion_respuestas"`);
    await q.query(`DROP TABLE IF EXISTS "evaluacion_intentos"`);
    await q.query(`DROP TABLE IF EXISTS "evaluacion_opciones"`);
    await q.query(`DROP TABLE IF EXISTS "evaluacion_preguntas"`);
    await q.query(`DROP TABLE IF EXISTS "evaluaciones"`);
    await q.query(`DROP TABLE IF EXISTS "curso_asignaciones"`);
    await q.query(`ALTER TABLE "cursos" DROP COLUMN IF EXISTS "privado"`);
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
   * violan: deja un WARNING en el log de Postgres y continúa. El bloque
   * EXCEPTION usa un savepoint, así que la transacción no se aborta.
   */
  private async tolerant(q: QueryRunner, sql: string) {
    await q.query(`DO $$ BEGIN
      ${sql};
    EXCEPTION WHEN foreign_key_violation OR unique_violation THEN
      RAISE WARNING 'PrivateCoursesAndEvaluations: se omitió por datos inconsistentes: %', SQLERRM;
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
