// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { seedAdminUser } from './common/seed-admin';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Habilitar CORS para ambos orígenes usados en desarrollo
  app.enableCors({
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
  });

  // Sirve carpeta uploads para imágenes
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });

  await seedAdminUser(app);

  await app.listen(process.env.PORT || 3001);
}
bootstrap();
