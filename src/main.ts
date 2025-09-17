// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { seedAdminUser } from './common/seed-admin';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // ✅ CORS sin errores de TypeScript
  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'https://moviesplus.xyz'
  ];

  // Agregar FRONTEND_URL si existe (ngrok dinámico)
  if (process.env.FRONTEND_URL) {
    allowedOrigins.push(process.env.FRONTEND_URL);
  }

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // ✅ Servir frontend en producción
  if (process.env.NODE_ENV === 'production') {
    app.useStaticAssets(join(__dirname, '..', 'public'), {
      prefix: '/',
    });
  }

  // Sirve carpeta uploads para imágenes
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });

  await seedAdminUser(app);
  await app.listen(process.env.PORT || 3001);
}
bootstrap();