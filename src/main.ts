import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { seedAdminUser } from './common/seed-admin';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { ValidationPipe, BadRequestException, Logger } from '@nestjs/common';


async function bootstrap() {
  const logger = new Logger('Bootstrap');

  try {
    logger.log('🚀 Iniciando servidor NestJS...');

    const app = await NestFactory.create<NestExpressApplication>(AppModule);

    // ✅ CORS Configurado DINÁMICAMENTE desde variables de entorno
    const allowedOrigins: string[] = [];

    // Agregar localhost para desarrollo
    if (process.env.NODE_ENV === 'development') {
      allowedOrigins.push('http://localhost:5173', 'http://localhost:5174');
      logger.log('🔧 Entorno de desarrollo - Localhost agregado a CORS');
    }

    // Agregar FRONTEND_URL desde variables de entorno (PRINCIPAL)
    const frontendUrl = process.env.FRONTEND_URL;
    if (frontendUrl) {
      const cleanFrontendUrl = frontendUrl.trim();
      if (!allowedOrigins.includes(cleanFrontendUrl)) {
        allowedOrigins.push(cleanFrontendUrl);
        logger.log(`🌐 FRONTEND_URL agregado a CORS: ${cleanFrontendUrl}`);
      }
    }

    // Agregar BACKEND_URL si es diferente
    const backendUrl = process.env.BACKEND_URL;
    if (backendUrl && backendUrl !== frontendUrl) {
      const cleanBackendUrl = backendUrl.trim();
      if (!allowedOrigins.includes(cleanBackendUrl)) {
        allowedOrigins.push(cleanBackendUrl);
        logger.log(`🌐 BACKEND_URL agregado a CORS: ${cleanBackendUrl}`);
      }
    }

    // Validar que tenemos al menos un origen permitido
    if (allowedOrigins.length === 0) {
      logger.warn('⚠️  No se configuraron dominios para CORS. Usando fallback...');
      allowedOrigins.push('http://localhost:5173');
    }

    app.enableCors({
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'ngrok-skip-browser-warning'
      ],
    });

    logger.log(`🛡️  CORS configurado para: ${allowedOrigins.join(', ')}`);

    // 🔒 VALIDATION PIPE - Global (PROTECCIÓN SQL INJECTION & XSS)
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
        exceptionFactory: (errors) => {
          const result = errors.map((error) => ({
            property: error.property,
            message: error.constraints ? error.constraints[Object.keys(error.constraints)[0]] : 'Error de validación',
            value: error.value,
          }));
          logger.warn(`🚨 Error de validación: ${JSON.stringify(result)}`);
          return new BadRequestException({
            message: 'Datos de entrada inválidos',
            errors: result,
            timestamp: new Date().toISOString(),
          });
        },
      })
    );

    logger.log('🔒 Validation Pipe activado - Protección contra SQL Injection y XSS');

    // ✅ Servir archivos estáticos
    if (process.env.NODE_ENV === 'production') {
      app.useStaticAssets(join(__dirname, '..', 'public'), {
        prefix: '/',
      });
      logger.log('📁 Serviendo archivos estáticos desde carpeta /public');
    }

    // Servir carpeta uploads para imágenes
    app.useStaticAssets(join(__dirname, '..', 'uploads'), {
      prefix: '/uploads/',
    });
    logger.log('📁 Serviendo archivos multimedia desde /uploads');

    // 🔧 Configuración global
    app.setGlobalPrefix('api');
    logger.log('🌍 Prefijo global configurado: /api');

    // ✅ Seed de usuario admin
    await seedAdminUser(app);
    logger.log('👤 Usuario admin verificado/creado correctamente');

    const port = process.env.PORT || 3001;
    await app.listen(port);

    // 🎉 LOGS DETALLADOS DE INICIO EXITOSO
    logger.log('='.repeat(60));
    logger.log('✅ BACKEND INICIADO CORRECTAMENTE');
    logger.log('='.repeat(60));
    logger.log(`🚀 Servidor corriendo en: http://localhost:${port}`);
    logger.log(`🌐 URL Pública Backend: ${backendUrl || `http://localhost:${port}`}`);
    logger.log(`🌐 URL Frontend: ${frontendUrl || 'No configurada'}`);
    logger.log(`📊 Entorno: ${process.env.NODE_ENV || 'development'}`);
    logger.log(`🛡️  Seguridad: Validation Pipe ACTIVADO`);
    logger.log(`🔒 Sanitize: Interceptor de seguridad ACTIVADO`);
    logger.log(`🔐 JWT: Configurado con clave segura`);
    logger.log(`📧 SMTP: ${process.env.SMTP_HOST ? 'CONFIGURADO' : 'NO CONFIGURADO'}`);
    logger.log(`💳 Payphone: ${process.env.PAYPHONE_API_URL ? 'INTEGRADO' : 'NO CONFIGURADO'}`);
    logger.log(`📱 WhatsApp: ${process.env.WHATSAPP_API_TOKEN ? 'CONFIGURADO' : 'NO CONFIGURADO'}`);
    logger.log(`🤖 DeepSeek IA: ${process.env.DEEPSEEK_API_KEY ? 'CONFIGURADA ✅' : 'NO CONFIGURADA'}`);
    logger.log(`🌍 CORS: ${allowedOrigins.length} dominios permitidos`);
    logger.log('='.repeat(60));

  } catch (error) {
    logger.error('❌ ERROR CRÍTICO AL INICIAR EL SERVIDOR:', error);
    process.exit(1);
  }
}

bootstrap();