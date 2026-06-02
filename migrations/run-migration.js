// Ejecuta el SQL de migración usando las credenciales del .env (driver pg).
// Uso: node migrations/run-migration.js
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

(async () => {
  const sqlFile = path.join(__dirname, '2026-06-categorias-recursos-logs.sql');
  const sql = fs.readFileSync(sqlFile, 'utf8');

  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  try {
    await client.connect();
    console.log(`✅ Conectado a ${process.env.DB_NAME}@${process.env.DB_HOST}`);
    await client.query(sql);
    console.log('✅ Migración aplicada correctamente.');

    const check = await client.query(`
      SELECT
        to_regclass('public.categorias')      AS categorias,
        to_regclass('public.curso_recursos')  AS curso_recursos,
        to_regclass('public.logs_acceso')     AS logs_acceso,
        (SELECT count(*) FROM information_schema.columns
           WHERE table_name='cursos' AND column_name='categoriaId') AS cursos_categoriaId
    `);
    console.log('🔎 Verificación:', check.rows[0]);
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
