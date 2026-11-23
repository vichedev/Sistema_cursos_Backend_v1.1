// src/database/data-source.ts
// DataSource para la CLI de TypeORM (npm run migration:*). La app NestJS usa
// la misma configuración desde AppModule.
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { ENTITIES } from './entities';

dotenv.config();

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  entities: ENTITIES,
  // .ts al ejecutar con ts-node (src), .js en dist (producción). Nunca .d.ts.
  migrations: [join(__dirname, 'migrations', __filename.endsWith('.ts') ? '*.ts' : '*.js')],
  migrationsTableName: 'migrations',
  synchronize: false,
});
