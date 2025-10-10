import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { seedAdminUser } from './common/seed-admin';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { ValidationPipe, BadRequestException, Logger } from '@nestjs/common';
import { CompressionObfuscationInterceptor } from './interceptors/compression-obfuscation.interceptor'; // ✅ SIN .ts

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
      // Limpiar y validar la URL
      const cleanFrontendUrl = frontendUrl.trim();
      if (!allowedOrigins.includes(cleanFrontendUrl)) {
        allowedOrigins.push(cleanFrontendUrl);
        logger.log(`🌐 FRONTEND_URL agregado a CORS: ${cleanFrontendUrl}`);
      }
    }

    // Agregar BACKEND_URL si es diferente (para casos específicos)
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
        'ngrok-skip-browser-warning',
        'x-accept-obfuscated' // ✅ AGREGAR para que el frontend pueda indicar que acepta ofuscación
      ],
    });

    logger.log(`🛡️  CORS configurado para: ${allowedOrigins.join(', ')}`);

    // ✅ INTERCEPTOR GLOBAL PARA OFUSCAR TODAS LAS RESPUESTAS
    app.useGlobalInterceptors(new CompressionObfuscationInterceptor());
    logger.log('🔒 CompressionObfuscationInterceptor activado - Todas las respuestas ofuscadas');

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

    // ✅ Servir archivos estáticos (ANTES del prefijo global)
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

    // 🔧 Configuración global de seguridad (DESPUÉS de archivos estáticos)
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
    logger.log(`🔐 JWT: Configurado con clave segura`);
    logger.log(`🔒 CompressionObfuscationInterceptor: ACTIVADO - Todas las respuestas ofuscadas`); // ✅ LOG ACTUALIZADO
    logger.log(`📧 SMTP: ${process.env.SMTP_HOST ? 'CONFIGURADO' : 'NO CONFIGURADO'}`);
    logger.log(`💳 Payphone: ${process.env.PAYPHONE_API_URL ? 'INTEGRADO' : 'NO CONFIGURADO'}`);
    logger.log(`📱 WhatsApp: ${process.env.WHATSAPP_API_TOKEN ? 'CONFIGURADO' : 'NO CONFIGURADO'}`);

    // ✅ NUEVO LOG: IA CARGADA CON ÉXITO
    logger.log(`🤖 DeepSeek IA: ${process.env.DEEPSEEK_API_KEY ? 'CONFIGURADA ✅ - Generación de descripciones activa' : 'NO CONFIGURADA'}`);

    logger.log(`🌍 CORS: ${allowedOrigins.length} dominios permitidos`);
    logger.log('='.repeat(60));
    logger.log('📚 Endpoints principales:');
    logger.log(`   🔐 Auth:     ${backendUrl || `http://localhost:${port}`}/api/auth`);
    logger.log(`   👥 Usuarios: ${backendUrl || `http://localhost:${port}`}/api/users`);
    logger.log(`   📊 Cursos:   ${backendUrl || `http://localhost:${port}`}/api/courses`);
    logger.log(`   💳 Pagos:    ${backendUrl || `http://localhost:${port}`}/api/payments`);
    logger.log(`   🖼️  Uploads:  ${backendUrl || `http://localhost:${port}`}/api/uploads`);

    // ✅ NUEVO LOG: Endpoint de IA
    logger.log(`   🤖 IA:       ${backendUrl || `http://localhost:${port}`}/api/courses/api/generate-description`);

    logger.log('='.repeat(60));

  } catch (error) {
    logger.error('❌ ERROR CRÍTICO AL INICIAR EL SERVIDOR:', error);
    process.exit(1);
  }
}

bootstrap();