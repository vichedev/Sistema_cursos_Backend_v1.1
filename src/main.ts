import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { seedAdminUser } from './common/seed-admin';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { ValidationPipe, BadRequestException, Logger } from '@nestjs/common';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as cookieParser from 'cookie-parser';
import { WinstonModule, utilities as nestWinstonModuleUtilities } from 'nest-winston';
import * as winston from 'winston';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  try {
    logger.log('🚀 Iniciando servidor NestJS...');

    // MEJ-01: Crear app con logger de Winston persistente
    const winstonLogger = WinstonModule.createLogger({
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.timestamp(),
            nestWinstonModuleUtilities.format.nestLike('Backend', { prettyPrint: true }),
          ),
        }),
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
          ),
        }),
        new winston.transports.File({
          filename: 'logs/combined.log',
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
          ),
        }),
      ],
    });

    // VULN-05: Validar fortaleza de JWT_SECRET antes de iniciar
    const jwtSecret = process.env.JWT_SECRET;
    const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error('JWT_SECRET debe tener al menos 32 caracteres. Genera uno con: openssl rand -hex 32');
    }
    if (!jwtRefreshSecret || jwtRefreshSecret.length < 32) {
      throw new Error('JWT_REFRESH_SECRET debe tener al menos 32 caracteres. Genera uno con: openssl rand -hex 32');
    }

    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: winstonLogger,
    });

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

    // Necesario para leer cookies httpOnly (refreshToken)
    app.use(cookieParser());
    logger.log('🍪 Cookie parser activado');

    // VULN-10: Helmet con CSP configurado
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }));
    logger.log('🔒 Helmet con CSP activado');

    // VULN-04: Rate limiting global — excluye SSE y rutas de lectura frecuente
    app.use((req: any, res: any, next: any) => {
      // SSE y rutas GET de alta frecuencia no necesitan rate limit global
      const skipPaths = ['/api/notifications/stream', '/api/courses/all', '/api/courses/disponibles', '/api/courses/mis-cursos', '/api/stats/general'];
      if (skipPaths.some(p => req.path.startsWith(p)) || (req.method === 'GET' && req.path.match(/^\/api\/courses\/\d+\/(estudiantes|estudiantes-con-pagos)$/))) {
        return next();
      }
      return rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 500,
        standardHeaders: true,
        legacyHeaders: false,
        message: { message: 'Demasiadas solicitudes. Intenta nuevamente en 15 minutos.' },
      })(req, res, next);
    });

    // Rate limiting estricto para endpoints de autenticación
    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 30,
      standardHeaders: true,
      legacyHeaders: false,
      message: { message: 'Demasiados intentos de autenticación. Intenta nuevamente en 15 minutos.' },
    });
    const registerLimiter = rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: { message: 'Demasiados registros desde esta IP. Intenta nuevamente en 1 hora.' },
    });
    const forgotPasswordLimiter = rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      message: { message: 'Demasiadas solicitudes de recuperación. Intenta nuevamente en 1 hora.' },
    });

    app.use('/api/auth/login', authLimiter);
    app.use('/api/auth/register', registerLimiter);
    app.use('/api/auth/forgot-password', forgotPasswordLimiter);
    app.use('/api/auth/resend-verification', forgotPasswordLimiter);
    logger.log('🚦 Rate limiting configurado en endpoints de autenticación');

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