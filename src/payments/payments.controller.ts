// src/payments/payments.controller.ts
import {
  Controller,
  Post,
  Body,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  Logger,
  Get,
  Query,
  Res,
  Request,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PayphoneService } from './payphone.service';
import { MailService } from '../common/mail.service';
import { CoursesService } from '../courses/courses.service';
import { UsersService } from '../users/users.service';
import { ConfigService } from '@nestjs/config';
import { CouponsService } from '../coupons/coupons.service';
import { SettingsService } from '../settings/settings.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StudentCourse } from '../courses/student-course.entity';
import { PaymentAttempt } from './payment-attempt.entity';
import { CouponUsage } from '../coupons/coupon-usage.entity';
import { Public } from '../auth/public.decorator';
import { v4 as uuidv4 } from 'uuid';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  // ✅ SERVICIO DE NOTIFICACIONES CENTRALIZADO
  private readonly notificationService: PaymentNotificationService;

  constructor(
    private payphoneService: PayphoneService,
    private mailService: MailService,
    private coursesService: CoursesService,
    private usersService: UsersService,
    private configService: ConfigService,
    private couponsService: CouponsService,
    private settingsService: SettingsService,
    private whatsappService: WhatsappService,
    @InjectRepository(StudentCourse)
    private studentCourseRepo: Repository<StudentCourse>,
    @InjectRepository(PaymentAttempt)
    private paymentAttemptRepo: Repository<PaymentAttempt>,
    @InjectRepository(CouponUsage)
    private couponUsageRepo: Repository<CouponUsage>,
  ) {
    this.notificationService = new PaymentNotificationService(
      mailService,
      settingsService,
      whatsappService,
    );
  }

  // ===============================
  // ✅ MÉTODOS DE CUPONES
  // ===============================

  @Post('release-coupon-by-transaction')
  @UseGuards(JwtAuthGuard)
  async releaseCouponByTransaction(
    @Body()
    body: {
      clientTransactionId: string;
      // ❌ ELIMINAR userId del body
    },
    @Request() req, // ✅ AGREGAR Request para obtener userId del token
  ) {
    this.logger.log(`=== LIBERANDO CUPÓN POR TRANSACCIÓN ===`);
    this.logger.log(`Body recibido:`, body);

    try {
      // ✅ OBTENER USER ID DEL TOKEN
      const userId = req.user.userId;

      if (!body.clientTransactionId) {
        throw new BadRequestException('clientTransactionId es requerido');
      }

      const paymentAttempt = await this.paymentAttemptRepo.findOne({
        where: {
          clientTransactionId: body.clientTransactionId,
          userId: userId, // ✅ Usar userId del token
        },
      });

      if (!paymentAttempt) {
        throw new BadRequestException('Transacción no encontrada');
      }

      if (paymentAttempt.cuponReservaId) {
        await this.couponsService.cancelCouponReservation(
          paymentAttempt.cuponReservaId,
        );
        this.logger.log(
          `✅ Cupón liberado - Reservation ID: ${paymentAttempt.cuponReservaId}`,
        );
      }

      return {
        success: true,
        message: 'Cupón liberado correctamente',
      };
    } catch (error) {
      this.logger.error('ERROR LIBERANDO CUPÓN POR TRANSACCIÓN:', error);
      throw new BadRequestException(
        error.message || 'Error al liberar el cupón',
      );
    }
  }

  // ===============================
  // ✅ MÉTODOS DE VALIDACIÓN DE SEGURIDAD
  // ===============================

  private validateUserAccess(requestUser: any, targetUserId: number): void {
    const requestUserId = requestUser.userId;
    const requestUserRol = requestUser.rol;

    // ✅ ADMIN tiene acceso completo
    if (requestUserRol === 'ADMIN') {
      return;
    }

    // ✅ Usuario normal solo puede acceder a sus propios pagos
    if (requestUserId === targetUserId) {
      return;
    }

    throw new BadRequestException(
      'No tienes permisos para acceder a esta información',
    );
  }

  private async validateCourseAndUser(
    cursoId: number,
    userId: number,
    requestUser: any,
  ) {
    // ✅ VALIDACIÓN SEGURA: Comparar el userId proporcionado con el del usuario autenticado
    if (userId !== requestUser.userId && requestUser.rol !== 'ADMIN') {
      throw new BadRequestException(
        'No tienes permisos para realizar esta acción',
      );
    }

    const course = await this.coursesService.findById(cursoId);
    if (!course) {
      throw new BadRequestException('Curso no existe');
    }

    if (course.cupos <= 0) {
      throw new BadRequestException('No hay cupos disponibles');
    }

    const usuario = await this.usersService.findById(userId);
    if (!usuario) {
      throw new BadRequestException('Usuario no encontrado');
    }

    const yaInscrito = await this.studentCourseRepo.findOne({
      where: { estudianteId: userId, cursoId },
    });

    if (yaInscrito) {
      throw new BadRequestException('Ya estás inscrito en este curso');
    }

    return { course, usuario };
  }

  // ===============================
  // ✅ ENDPOINTS DE PAGO SEGUROS
  // ===============================
  @Post('create-payphone-payment')
  async createPayphonePayment(
    @Body() body: { cursoId: number }, // ❌ ELIMINAR userId del body
    @Request() req,
  ) {
    this.logger.log(`=== INICIO CREATE PAYPHONE PAYMENT ===`);

    try {
      // ✅ USAR EL USER ID DEL USUARIO AUTENTICADO
      const userId = req.user.userId;

      const { course, usuario } = await this.validateCourseAndUser(
        body.cursoId,
        userId, // ✅ Usar userId del token
        req.user,
      );
      this.logger.log(
        `💰 PAGO CREADO PARA: ${usuario.correo} - Curso: ${course.titulo} - Precio: $${course.precio}`,
      );
      const clientTransactionId = `CURSO-${body.cursoId}-${userId}-${Date.now()}-${uuidv4().substring(0, 8)}`;

      const paymentAttempt = await this.paymentAttemptRepo.save({
        clientTransactionId,
        cursoId: body.cursoId,
        userId: userId, // ✅ Usar userId del token
        amount: course.precio,
        status: 'PENDIENTE',
      });

      this.logger.log(
        `Creando pago Payphone para curso ${course.titulo} - Usuario: ${usuario.correo}`,
      );

      const paymentData = await this.payphoneService.createPayment(
        course.precio,
        clientTransactionId,
        usuario.correo,
        {
          cursoId: body.cursoId,
          userId: userId, // ✅ Usar userId del token
          cursoTitulo: course.titulo,
          userData: {
            nombres: usuario.nombres,
            apellidos: usuario.apellidos,
            celular: usuario.celular,
            email: usuario.correo,
          },
        },
      );

      return {
        success: true,
        paymentUrl: paymentData.paymentUrl,
        paymentId: paymentData.paymentId,
        clientTransactionId: paymentData.clientTransactionId,
      };
    } catch (error) {
      this.logger.error('ERROR EN CREATE PAYPHONE PAYMENT:', error);
      throw new BadRequestException(
        error.message || 'Error al crear el pago con Payphone',
      );
    }
  }

  @Post('create-payphone-payment-with-coupon')
  async createPayphonePaymentWithCoupon(
    @Body()
    body: {
      cursoId: number;
      codigoCupon: string;
    },
    @Request() req,
  ) {
    this.logger.log(`=== INICIO CREATE PAYPHONE PAYMENT WITH COUPON ===`);

    let reservationId: number | null = null;

    try {
      // ✅ USAR EL USER ID DEL USUARIO AUTENTICADO
      const userId = req.user.userId;

      const { course, usuario } = await this.validateCourseAndUser(
        body.cursoId,
        userId, // ✅ Usar userId del token, no del body
        req.user,
      );

      if (!body.codigoCupon) {
        throw new BadRequestException('codigoCupon es requerido');
      }

      // ✅ RESERVAR CUPÓN
      const cuponReserva = await this.couponsService.reserveCoupon(
        body.cursoId,
        body.codigoCupon,
        userId, // ✅ Usar userId del token
      );

      if (!cuponReserva.success) {
        throw new BadRequestException('Error al reservar cupón');
      }

      reservationId = cuponReserva.reservationId;

      // ✅ CALCULAR PRECIO CON DESCUENTO
      const precioConDescuento = this.calculateDiscountedPrice(
        course.precio,
        cuponReserva.cupon.tipo,
      );

      // ✅ NUEVO LOG CON CORREO Y CUPÓN
      this.logger.log(
        `🎁 PAGO CON CUPÓN CREADO PARA: ${usuario.correo} - Curso: ${course.titulo}`,
      );
      this.logger.log(
        `   💰 Precio original: $${course.precio} → Precio con descuento: $${precioConDescuento}`,
      );
      this.logger.log(
        `   🎫 Cupón aplicado: ${body.codigoCupon} (${cuponReserva.cupon.tipo})`,
      );

      // ✅ SI ES GRATIS, CONFIRMAR INMEDIATAMENTE
      if (precioConDescuento === 0) {
        this.logger.log(
          `🎉 INSCRIPCIÓN GRATIS CON CUPÓN: ${usuario.correo} - Curso: ${course.titulo}`,
        );
        return await this.processFreeCouponRegistration(
          body.cursoId,
          userId, // ✅ Usar userId del token
          course,
          usuario,
          reservationId,
          cuponReserva,
        );
      }

      // ✅ CREAR PAGO CON DESCUENTO
      const clientTransactionId = `CUPON-${body.cursoId}-${userId}-${Date.now()}-${uuidv4().substring(0, 8)}`;

      await this.paymentAttemptRepo.save({
        clientTransactionId,
        cursoId: body.cursoId,
        userId: userId, // ✅ Usar userId del token
        amount: precioConDescuento,
        status: 'PENDIENTE_CON_CUPON',
        cuponReservaId: reservationId,
      });

      const paymentData = await this.payphoneService.createPayment(
        precioConDescuento,
        clientTransactionId,
        usuario.correo,
        {
          cursoId: body.cursoId,
          userId: userId, // ✅ Usar userId del token
          cursoTitulo: course.titulo,
          cupon: cuponReserva.cupon,
          precioOriginal: course.precio,
          descuentoAplicado: course.precio - precioConDescuento,
          userData: {
            nombres: usuario.nombres,
            apellidos: usuario.apellidos,
            celular: usuario.celular,
            email: usuario.correo,
          },
        },
      );

      return {
        success: true,
        gratis: false,
        paymentUrl: paymentData.paymentUrl,
        paymentId: paymentData.paymentId,
        clientTransactionId: paymentData.clientTransactionId,
        cupon: cuponReserva.cupon,
        precioOriginal: course.precio,
        precioConDescuento,
        ahorro: course.precio - precioConDescuento,
        reservationId,
      };
    } catch (error) {
      this.logger.error('ERROR EN CREATE PAYPHONE PAYMENT WITH COUPON:', error);

      // ✅ CANCELAR RESERVA SI HUBO ERROR
      if (reservationId) {
        try {
          await this.couponsService.cancelCouponReservation(reservationId);
        } catch (cancelError) {
          this.logger.error(`Error cancelando reserva:`, cancelError);
        }
      }

      throw new BadRequestException(
        error.message || 'Error al crear el pago con cupón',
      );
    }
  }

  // ===============================
  // ✅ ENDPOINT DE CALLBACK PÚBLICO (SIN AUTENTICACIÓN)
  // ===============================
  // VULN-03: Rate limiting estricto en webhook — 20 req/min por IP
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Public()
  @Get('payphone-confirm')
  async payphoneConfirm(
    @Query('id') id: string,
    @Query('clientTransactionId') clientTransactionId: string,
    @Res() res: Response,
  ) {
    this.logger.log(`🔔 === CALLBACK PAYPHONE RECIBIDO ===`);

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';

    try {
      if (!id || !clientTransactionId) {
        this.logger.error('❌ Parámetros faltantes en callback');
        return res.redirect(
          `${frontendUrl}/pago-fallido?error=parametros_faltantes`,
        );
      }

      this.logger.log(
        `📞 Callback recibido - Payphone ID: ${id} - ClientTxId: ${clientTransactionId}`,
      );

      const paymentAttempt = await this.paymentAttemptRepo.findOne({
        where: { clientTransactionId },
      });

      if (!paymentAttempt) {
        this.logger.error(
          `❌ PaymentAttempt no encontrado para: ${clientTransactionId}`,
        );
        return res.redirect(
          `${frontendUrl}/pago-fallido?error=pago_no_encontrado`,
        );
      }

      // ✅ OBTENER INFO DEL USUARIO Y CURSO PARA LOGS DETALLADOS
      let userEmail = 'Email no disponible';
      let courseName = 'Curso no disponible';

      try {
        const usuario = await this.usersService.findById(paymentAttempt.userId);
        const course = await this.coursesService.findById(
          paymentAttempt.cursoId,
        );

        userEmail = usuario ? usuario.correo : 'Email no disponible';
        courseName = course ? course.titulo : 'Curso no disponible';

        this.logger.log(
          `👤 Información obtenida - Usuario: ${userEmail} - Curso: ${courseName} - Monto: $${paymentAttempt.amount}`,
        );
      } catch (infoError) {
        this.logger.warn(
          `⚠️ No se pudo obtener información completa del usuario/curso: ${infoError.message}`,
        );
      }

      // ✅ PROTECCIÓN: Evitar doble procesamiento
      if (
        paymentAttempt.status === 'Approved' ||
        paymentAttempt.status === 'GRATIS_CON_CUPON'
      ) {
        this.logger.warn(
          `⚠️ PAGO YA PROCESADO - Usuario: ${userEmail} - Curso: ${courseName} - ClientTxId: ${clientTransactionId}`,
        );
        return res.redirect(
          `${frontendUrl}/pago-exitoso?clientTransactionId=${clientTransactionId}&already_processed=true`,
        );
      }

      this.logger.log(
        `🔍 Verificando estado con Payphone... - Usuario: ${userEmail}`,
      );

      // ✅ VERIFICAR CON PAYPHONE
      const confirmacionData = await this.payphoneService.confirmTransaction(
        id,
        clientTransactionId,
      );
      const estadoReal = confirmacionData.transactionStatus;

      this.logger.log(
        `📊 Estado Payphone: ${estadoReal} - Usuario: ${userEmail} - Curso: ${courseName}`,
      );

      await this.paymentAttemptRepo.update(paymentAttempt.id, {
        payphoneId: id,
        status: estadoReal,
        callbackData: JSON.stringify({
          ...confirmacionData,
          verificadoEn: new Date().toISOString(),
        }),
      });

      this.logger.log(
        `💾 Estado guardado en BD: ${estadoReal} - Usuario: ${userEmail}`,
      );

      // ✅ PROCESAR SEGÚN ESTADO
      if (estadoReal === 'Approved') {
        this.logger.log(
          `🎉 PAGO APROBADO - Usuario: ${userEmail} - Curso: ${courseName} - Monto: $${paymentAttempt.amount}`,
        );

        // ✅ LOG ESPECIAL PARA CUPONES
        if (paymentAttempt.cuponReservaId) {
          this.logger.log(
            `🎁 PAGO CON CUPÓN EXITOSO - Usuario: ${userEmail} - Cupón aplicado`,
          );
        }

        await this.processSuccessfulPayment(paymentAttempt);
        this.logger.log(
          `✅ Procesamiento completado - Usuario: ${userEmail} - Inscripción confirmada`,
        );

        return res.redirect(
          `${frontendUrl}/pago-exitoso?clientTransactionId=${clientTransactionId}`,
        );
      } else if (this.isFailedPaymentStatus(estadoReal)) {
        this.logger.warn(
          `❌ PAGO FALLIDO - Usuario: ${userEmail} - Curso: ${courseName} - Estado: ${estadoReal}`,
        );

        // ✅ LOG ESPECIAL PARA LIBERACIÓN DE CUPONES
        if (paymentAttempt.cuponReservaId) {
          this.logger.log(
            `🔄 Liberando cupón por pago fallido - Usuario: ${userEmail}`,
          );
        }

        await this.processFailedPayment(paymentAttempt, estadoReal);
        this.logger.log(
          `✅ Procesamiento de fallo completado - Usuario: ${userEmail}`,
        );

        return res.redirect(
          `${frontendUrl}/pago-fallido?clientTransactionId=${clientTransactionId}&status=${estadoReal}`,
        );
      } else {
        this.logger.log(
          `⏳ PAGO PENDIENTE - Usuario: ${userEmail} - Curso: ${courseName} - Estado: ${estadoReal}`,
        );
        return res.redirect(
          `${frontendUrl}/pago-pendiente?clientTransactionId=${clientTransactionId}&status=${estadoReal}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `💥 Error CRÍTICO en callback - ClientTxId: ${clientTransactionId}:`,
        error,
      );

      // ✅ INTENTAR OBTENER MÁS INFORMACIÓN PARA EL LOG DE ERROR
      try {
        const paymentAttempt = await this.paymentAttemptRepo.findOne({
          where: { clientTransactionId },
        });
        if (paymentAttempt) {
          const usuario = await this.usersService.findById(
            paymentAttempt.userId,
          );
          this.logger.error(
            `💥 Error afectando al usuario: ${usuario?.correo || 'Desconocido'}`,
          );
        }
      } catch (infoError) {
        // No hacer nada si falla la obtención de info adicional
      }

      return res.redirect(
        `${frontendUrl}/pago-pendiente?error=error_procesamiento`,
      );
    }
  }

  // ===============================
  // ✅ ENDPOINTS DE CONSULTA SEGUROS
  // ===============================

  @Get('check-payment-status')
  async checkPaymentStatus(
    @Query('clientTransactionId') clientTransactionId: string,
    @Request() req,
  ) {
    try {
      if (!clientTransactionId) {
        throw new BadRequestException('clientTransactionId es requerido');
      }

      const paymentAttempt = await this.paymentAttemptRepo.findOne({
        where: { clientTransactionId },
      });

      if (!paymentAttempt) {
        return { success: false, error: 'Pago no encontrado' };
      }

      // ✅ VALIDAR QUE EL USUARIO PUEDE VER ESTE PAGO
      this.validateUserAccess(req.user, paymentAttempt.userId);

      return {
        success:
          paymentAttempt.status === 'Approved' ||
          paymentAttempt.status === 'GRATIS_CON_CUPON',
        status: paymentAttempt.status,
        paymentId: paymentAttempt.payphoneId,
        clientTransactionId: paymentAttempt.clientTransactionId,
        amount: paymentAttempt.amount,
      };
    } catch (error) {
      this.logger.error(`Error verificando pago:`, error);
      return { success: false, error: 'Error verificando estado del pago' };
    }
  }

  // ===============================
  // ✅ ENDPOINT PARA INSCRIPCIÓN GRATUITA
  // ===============================

  @Post('inscribir-gratis')
  @UseGuards(JwtAuthGuard)
  async inscribirGratis(@Body() body: { cursoId: number }, @Request() req) {
    this.logger.log(`🎓 === INICIO INSCRIPCIÓN GRATUITA ===`);

    try {
      // ✅ OBTENER USER ID DEL TOKEN
      const userId = req.user.userId;

      if (!body.cursoId) {
        throw new BadRequestException('cursoId es requerido');
      }

      // ✅ VALIDAR CURSO Y USUARIO
      const { course, usuario } = await this.validateCourseAndUser(
        body.cursoId,
        userId,
        req.user,
      );

      // ✅ LOG INFORMATIVO DETALLADO
      this.logger.log(`🎓 INSCRIPCIÓN GRATUITA INICIADA:`);
      this.logger.log(`   👤 Usuario: ${usuario.correo}`);
      this.logger.log(`   📚 Curso: ${course.titulo}`);
      this.logger.log(`   📞 Teléfono: ${usuario.celular || 'No disponible'}`);

      // ✅ ACTUALIZAR CUPOS
      await this.coursesService.updateCupos(
        course.id,
        Math.max(0, course.cupos - 1),
      );
      this.logger.log(
        `   ✅ Cupos actualizados: ${course.cupos - 1} restantes`,
      );

      // ✅ CREAR INSCRIPCIÓN
      await this.studentCourseRepo.save({
        estudianteId: userId,
        cursoId: body.cursoId,
        pagado: true,
      });
      this.logger.log(`   ✅ Inscripción guardada en base de datos`);

      // ✅ CREAR PAYMENT ATTEMPT PARA SEGUIMIENTO
      const clientTransactionId = `GRATIS-${body.cursoId}-${userId}-${Date.now()}`;

      await this.paymentAttemptRepo.save({
        clientTransactionId,
        cursoId: body.cursoId,
        userId: userId,
        amount: 0,
        status: 'GRATIS',
        payphoneId: 'NO_PAYMENT_NEEDED',
        callbackData: JSON.stringify({
          mensaje: 'Inscripción gratuita directa',
          timestamp: new Date().toISOString(),
        }),
      });
      this.logger.log(`   ✅ PaymentAttempt creado: ${clientTransactionId}`);

      // ✅ NOTIFICACIONES EN SEGUNDO PLANO (no bloquean la respuesta → inscripción ágil)
      //    El correo/WhatsApp se envían tras responder; si fallan, no afectan la inscripción.
      this.logger.log(`   📧 Enviando notificaciones en segundo plano...`);
      this.notificationService
        .sendEnrollmentNotifications(course, usuario, 'Gratuito')
        .then(() => this.logger.log(`   ✅ Notificaciones (gratis) enviadas a ${usuario.correo}`))
        .catch((notificationError) =>
          this.logger.error(`   ❌ Error enviando notificaciones (gratis):`, notificationError),
        );

      this.logger.log(`🎉 INSCRIPCIÓN GRATUITA COMPLETADA EXITOSAMENTE`);

      return {
        success: true,
        message: 'Inscrito correctamente al curso gratuito',
        clientTransactionId,
      };
    } catch (error) {
      this.logger.error(`❌ ERROR EN INSCRIPCIÓN GRATUITA:`, error);

      // ✅ LOG ADICIONAL DEL ERROR
      try {
        const userId = req.user.userId;
        this.logger.error(
          `   👤 Error afectando al usuario ID: ${userId} - Curso ID: ${body?.cursoId}`,
        );
      } catch (logError) {
        // No hacer nada si no se puede obtener info adicional
      }

      throw new BadRequestException(
        error.message || 'Error al inscribirse al curso gratuito',
      );
    }
  }

  // ===============================
  // ✅ VERIFICAR CUPÓN
  // ===============================

  @Post('verify-coupon')
  async verifyCoupon(
    @Body()
    body: {
      cursoId: number;
      codigoCupon: string;
      // ❌ ELIMINAR userId del body - usar siempre el del usuario autenticado
    },
    @Request() req,
  ) {
    try {
      // ✅ USAR SIEMPRE EL USER ID DEL USUARIO AUTENTICADO
      const userId = req.user.userId;

      if (!body.cursoId || !body.codigoCupon) {
        this.logger.warn(
          `❌ Parámetros faltantes en verify-coupon - Usuario ID: ${userId}`,
        );
        throw new BadRequestException('cursoId y codigoCupon son requeridos');
      }

      this.logger.log(`🔍 === INICIO VERIFICACIÓN DE CUPÓN ===`);
      this.logger.log(
        `   👤 Usuario ID: ${userId} - Curso ID: ${body.cursoId} - Cupón: ${body.codigoCupon}`,
      );

      const course = await this.coursesService.findById(body.cursoId);
      if (!course) {
        this.logger.error(
          `❌ Curso no encontrado - Curso ID: ${body.cursoId} - Usuario: ${userId}`,
        );
        throw new BadRequestException('Curso no encontrado');
      }

      // ✅ OBTENER INFORMACIÓN DEL USUARIO PARA LOGS
      let userEmail = 'Email no disponible';
      try {
        const usuario = await this.usersService.findById(userId);
        userEmail = usuario ? usuario.correo : 'Email no disponible';
      } catch (userError) {
        this.logger.warn(
          `⚠️ No se pudo obtener email del usuario ID: ${userId}`,
        );
      }

      this.logger.log(
        `🎯 Verificando cupón - Usuario: ${userEmail} - Curso: ${course.titulo} - Cupón: ${body.codigoCupon}`,
      );

      const verificationResult = await this.couponsService.verifyCoupon(
        body.cursoId,
        body.codigoCupon,
        userId, // ✅ Usar el ID del usuario autenticado
      );

      if (!verificationResult.valid || !verificationResult.cupon) {
        this.logger.warn(
          `❌ CUPÓN INVÁLIDO - Usuario: ${userEmail} - Curso: ${course.titulo}`,
        );
        this.logger.warn(
          `   🎫 Cupón: ${body.codigoCupon} - Error: ${verificationResult.error}`,
        );

        return {
          success: false,
          error: verificationResult.error || 'Error al verificar cupón',
        };
      }

      const precioConDescuento = this.calculateDiscountedPrice(
        course.precio,
        verificationResult.cupon.tipo,
      );

      const ahorro = course.precio - precioConDescuento;
      const esGratis = precioConDescuento === 0;

      // ✅ LOG DETALLADO DE CUPÓN VÁLIDO
      this.logger.log(
        `✅ CUPÓN VÁLIDO APLICADO - Usuario: ${userEmail} - Curso: ${course.titulo}`,
      );
      this.logger.log(
        `   🎫 Código: ${body.codigoCupon} - Tipo: ${verificationResult.cupon.tipo}`,
      );
      this.logger.log(
        `   💰 Precio: $${course.precio} → $${precioConDescuento} (Ahorro: $${ahorro})`,
      );

      if (esGratis) {
        this.logger.log(
          `   🎉 ¡CURSO GRATIS! - Cupón aplica 100% de descuento`,
        );
      } else {
        this.logger.log(
          `   📊 Descuento: ${((ahorro / course.precio) * 100).toFixed(1)}% aplicado`,
        );
      }

      return {
        success: true,
        valid: true,
        cupon: verificationResult.cupon,
        precioOriginal: course.precio,
        precioConDescuento,
        ahorro: ahorro,
        gratis: esGratis,
      };
    } catch (error) {
      this.logger.error(`💥 ERROR en verify-coupon:`, error);

      // ✅ LOG ADICIONAL DEL ERROR
      try {
        const userId = req.user.userId;
        this.logger.error(
          `   👤 Error afectando al usuario ID: ${userId} - Curso ID: ${body?.cursoId}`,
        );
      } catch (logError) {
        // No hacer nada si no se puede obtener info adicional
      }

      return {
        success: false,
        error: error.message || 'Error al verificar cupón',
      };
    }
  }

  // ===============================
  // ✅ ENDPOINTS ADMIN (SOLO ADMIN)
  // ===============================

  @Post('force-release-coupon')
  @UseGuards(JwtAuthGuard)
  async forceReleaseCoupon(
    @Body()
    body: {
      codigoCupon: string;
      cursoId: number;
      // ❌ ELIMINAR userId del body
    },
    @Request() req, // ✅ AGREGAR Request
  ) {
    this.logger.log(`=== FORZANDO LIBERACIÓN DE CUPÓN ===`);

    try {
      // ✅ OBTENER USER ID DEL TOKEN
      const userId = req.user.userId;

      const result = await this.couponsService.forceReleaseCoupon(
        body.codigoCupon,
        userId, // ✅ Usar del token
        body.cursoId,
      );

      return result;
    } catch (error) {
      this.logger.error('ERROR FORZANDO LIBERACIÓN:', error);
      throw new BadRequestException(
        error.message || 'Error al forzar liberación del cupón',
      );
    }
  }

  @Get('debug-payment')
  @Roles('ADMIN')
  async debugPayment(
    @Query('clientTransactionId') clientTransactionId: string,
  ) {
    // VULN-08: Endpoint de debug deshabilitado en producción
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Este endpoint no está disponible en producción');
    }

    try {
      const paymentAttempt = await this.paymentAttemptRepo.findOne({
        where: { clientTransactionId },
      });

      if (!paymentAttempt) {
        return { success: false, error: 'No encontrado' };
      }

      return {
        success: true,
        data: paymentAttempt,
        callbackData: paymentAttempt.callbackData
          ? JSON.parse(paymentAttempt.callbackData)
          : null,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  @Post('cleanup-expired-reservations')
  @Roles('ADMIN')
  async cleanupExpiredReservations() {
    try {
      await this.couponsService.cleanupExpiredReservations();
      return {
        success: true,
        message: 'Limpieza de reservas expiradas completada',
      };
    } catch (error) {
      this.logger.error('Error en limpieza de reservas:', error);
      throw new BadRequestException('Error al limpiar reservas expiradas');
    }
  }

  // ===============================
  // ✅ MÉTODOS PRIVADOS AUXILIARES
  // ===============================

  private calculateDiscountedPrice(
    precioOriginal: number,
    tipoCupon: string,
  ): number {
    switch (tipoCupon) {
      case 'PORCENTAJE_10':
        return precioOriginal * 0.9;
      case 'PORCENTAJE_15':
        return precioOriginal * 0.85;
      case 'PORCENTAJE_30':
        return precioOriginal * 0.7;
      case 'PORCENTAJE_50':
        return precioOriginal * 0.5;
      case 'GRATIS':
        return 0;
      default:
        return precioOriginal;
    }
  }

  private isFailedPaymentStatus(status: string): boolean {
    return ['Canceled', 'Rejected', 'Expired', 'Failed'].includes(status);
  }

  private async processFreeCouponRegistration(
    cursoId: number,
    userId: number,
    course: any,
    usuario: any,
    reservationId: number,
    cuponReserva: any,
  ) {
    this.logger.log(
      `🎁 Cupón GRATIS detectado - Confirmando e inscribiendo directamente`,
    );

    await this.couponsService.confirmCouponUsage(reservationId);
    await this.coursesService.updateCupos(
      course.id,
      Math.max(0, course.cupos - 1),
    );

    await this.studentCourseRepo.save({
      estudianteId: userId,
      cursoId,
      pagado: true,
    });

    const clientTransactionId = `CUPON-GRATIS-${cursoId}-${userId}-${Date.now()}`;

    await this.paymentAttemptRepo.save({
      clientTransactionId,
      cursoId,
      userId,
      amount: 0,
      status: 'GRATIS_CON_CUPON',
      payphoneId: 'NO_PAYMENT_NEEDED',
      cuponReservaId: reservationId,
      callbackData: JSON.stringify({
        cupon: cuponReserva.cupon,
        mensaje: 'Inscripción gratuita mediante cupón',
      }),
    });

    // ✅ ENVIAR NOTIFICACIONES
    await this.notificationService.sendEnrollmentNotifications(
      course,
      usuario,
      'Cupón Gratis',
    );

    return {
      success: true,
      gratis: true,
      message: '¡Inscripción exitosa con cupón gratis!',
      cupon: cuponReserva.cupon,
      clientTransactionId,
    };
  }

  private async processSuccessfulPayment(paymentAttempt: PaymentAttempt) {
    this.logger.log(`🎉 Pago APROBADO por Payphone`);

    // ✅ CONFIRMAR USO DEL CUPÓN SI EXISTE RESERVA
    if (paymentAttempt.cuponReservaId) {
      try {
        await this.couponsService.confirmCouponUsage(
          paymentAttempt.cuponReservaId,
        );
      } catch (error) {
        this.logger.error(`❌ Error confirmando cupón:`, error);
      }
    }

    // ✅ PROCESAR INSCRIPCIÓN
    const course = await this.coursesService.findById(paymentAttempt.cursoId);
    const estudiante = await this.usersService.findById(paymentAttempt.userId);

    if (!course || !estudiante) {
      throw new Error('Curso o estudiante no encontrado');
    }

    // Evitar doble inscripción
    const yaInscrito = await this.studentCourseRepo.findOne({
      where: {
        estudianteId: paymentAttempt.userId,
        cursoId: paymentAttempt.cursoId,
      },
    });

    if (!yaInscrito) {
      await this.coursesService.updateCupos(
        course.id,
        Math.max(0, course.cupos - 1),
      );
      await this.studentCourseRepo.save({
        estudianteId: paymentAttempt.userId,
        cursoId: paymentAttempt.cursoId,
        pagado: true,
      });
    }

    // ✅ ENVIAR NOTIFICACIONES
    const metodoPago = paymentAttempt.cuponReservaId
      ? 'Payphone con Cupón'
      : 'Payphone';
    await this.notificationService.sendEnrollmentNotifications(
      course,
      estudiante,
      metodoPago,
    );
  }

  private async processFailedPayment(
    paymentAttempt: PaymentAttempt,
    estado: string,
  ) {
    this.logger.warn(`❌ Pago fallido - Estado: ${estado}`);

    // ✅ LIBERAR CUPÓN
    if (paymentAttempt.cuponReservaId) {
      try {
        await this.couponsService.cancelCouponReservation(
          paymentAttempt.cuponReservaId,
        );
      } catch (error) {
        this.logger.error(`❌ Error liberando cupón:`, error);
      }
    }
  }
}

// ===============================
// ✅ SERVICIO DE NOTIFICACIONES (Separado para reutilización)
// ===============================
class PaymentNotificationService {
  constructor(
    private mailService: MailService,
    private settings: SettingsService,
    private whatsapp: WhatsappService,
  ) {}

  // Datos de contacto/notificación leídos en CALIENTE desde el panel admin
  // (con fallback al .env vía SettingsService).
  private get notificacionesInscripciones(): string {
    return this.settings.get('notif_inscripciones') || 'cursos@rednuevaconexion.net';
  }
  private get alertasSistema(): string {
    return this.settings.get('notif_alertas') || 'cursos@rednuevaconexion.net';
  }
  private get correoSoporte(): string {
    return this.settings.get('soporte_correo') || 'vzamora@maat.ec';
  }
  private get telefonoSoporte(): string {
    return this.settings.get('soporte_telefono') || '0986819378';
  }
  private get correosAdminExtra(): string[] {
    const extra = this.settings.get('correos_admin_extra');
    return extra ? extra.split(',').map((e) => e.trim()).filter(Boolean) : [];
  }

  async sendEnrollmentNotifications(
    course: any,
    student: any,
    paymentMethod: string,
  ) {
    try {
      // ✅ ENVÍO INDEPENDIENTE - WhatsApp se envía aunque falle el email
      const emailPromise = this.sendStudentEmail(
        course,
        student,
        paymentMethod,
      ).catch((error) => {
        console.error(
          '❌ Error enviando email, pero continuando con WhatsApp:',
          error.message,
        );
        return null; // Retornar null para indicar fallo
      });

      const whatsappPromise = this.sendStudentWhatsApp(
        course,
        student,
        paymentMethod,
      ).catch((error) => {
        console.error('❌ Error enviando WhatsApp:', error.message);
        return null; // Retornar null para indicar fallo
      });

      const adminPromise = this.sendAdminNotification(
        course,
        student,
        paymentMethod,
      ).catch((error) => {
        console.error('❌ Error enviando notificación admin:', error.message);
        return null; // Retornar null para indicar fallo
      });

      // ✅ ESPERAR TODAS LAS PROMESAS INDEPENDIENTEMENTE
      const resultados = await Promise.allSettled([
        emailPromise,
        whatsappPromise,
        adminPromise,
      ]);

      // ✅ LOG DEL RESULTADO DETALLADO
      console.log(`📊 Resumen notificaciones para ${student.correo}:`);
      console.log(
        `   📧 Email: ${resultados[0].status === 'fulfilled' && resultados[0].value !== null ? '✅ Enviado' : '❌ Falló'}`,
      );
      console.log(
        `   📱 WhatsApp: ${resultados[1].status === 'fulfilled' && resultados[1].value !== null ? '✅ Enviado' : '❌ Falló'}`,
      );
      console.log(
        `   👨‍💼 Admin: ${resultados[2].status === 'fulfilled' && resultados[2].value !== null ? '✅ Enviado' : '❌ Falló'}`,
      );
    } catch (error) {
      console.error('💥 Error crítico en sistema de notificaciones:', error);
    }
  }

  // En payments.controller.ts - Clase PaymentNotificationService

  private async sendStudentEmail(
    course: any,
    student: any,
    paymentMethod: string,
  ) {
    try {
      const profesorNombre = course.profesor
        ? `${course.profesor.nombres} ${course.profesor.apellidos}`
        : 'Por confirmar';

      const linkCurso = course.link || 'Link por confirmar';
      const tieneLinkDisponible = !!course.link;

      // ℹ️ El material didáctico ya NO se envía aquí. El administrador decide
      //    cuándo y a quién enviarlo desde el panel de recursos del curso.

      const emailContent = `
      <div style="font-family: Arial, sans-serif; color:#222;">
        <h2>🎉 ¡Inscripción confirmada!</h2>
        <p>Hola <b>${student.nombres}</b>,<br>
        Te confirmamos tu inscripción al siguiente curso:</p>
        
        <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; margin: 15px 0;">
          <h3 style="margin: 0 0 10px 0; color: #0369a1;">${course.titulo}</h3>
          <p style="margin: 5px 0;"><b>📖</b> ${course.descripcion}</p>
          <p style="margin: 5px 0;"><b>📅</b> ${course.fecha ? new Date(course.fecha).toLocaleDateString() : 'Por confirmar'} | <b>🕐</b> ${course.hora || 'Por confirmar'}</p>
          <p style="margin: 5px 0;"><b>👨‍🏫</b> ${profesorNombre}</p>
          <p style="margin: 5px 0;"><b>💰</b> $${course.precio || 0} (${paymentMethod})</p>
          ${tieneLinkDisponible ? `<p style="margin: 5px 0;"><b>🔗</b> <a href="${linkCurso}">Acceder a la clase</a></p>` : ''}
        </div>

        <div style="margin-top: 20px; padding: 15px; background-color: #f5f5f5; border-radius: 5px;">
          <h4 style="margin: 0 0 10px 0;">📞 ¿Necesitas ayuda?</h4>
          <p style="margin: 5px 0;"><b>Teléfono:</b> ${this.telefonoSoporte}</p>
          <p style="margin: 5px 0;"><b>Email:</b> <a href="mailto:${this.correoSoporte}">${this.correoSoporte}</a></p>
        </div>
        
        <br>
        <p><i>¡Nos vemos en el curso!</i></p>
        <hr>
        <small>Sistema de Cursos MAAT</small>
      </div>
    `;

      await this.mailService.sendMail(
        student.correo,
        '🎉 Confirmación de inscripción al curso',
        emailContent,
      );

      console.log(`✅ Email de inscripción enviado a: ${student.correo}`);
      return true;
    } catch (error) {
      console.error(
        `❌ Error enviando email a ${student.correo}:`,
        error.message,
      );
      throw error;
    }
  }

  private async sendStudentWhatsApp(
    course: any,
    student: any,
    paymentMethod: string,
  ) {
    if (!student.celular) {
      console.log(
        `⚠️ No se envía WhatsApp: teléfono no disponible para ${student.correo}`,
      );
      return null;
    }

    try {
      const profesorNombre = course.profesor
        ? `${course.profesor.nombres} ${course.profesor.apellidos}`
        : 'Por confirmar';

      const linkCurso = course.link || 'Por confirmar';
      const tieneLinkDisponible = !!course.link;

      // ✅ RECURSOS SOLO PARA INSCRITOS
      const recursosTexto = course.recursosLink
        ? `\n📚 *Recursos exclusivos:*\n${course.recursosLink}`
        : '';

      const mensaje = `🎉 *¡INSCRIPCIÓN CONFIRMADA!* 

Hola ${student.nombres} 👋

Te confirmamos tu inscripción al curso:
📚 *${course.titulo}*

📖 ${course.descripcion}

📅 *Fecha:* ${course.fecha ? new Date(course.fecha).toLocaleDateString() : 'Por confirmar'}
🕐 *Hora:* ${course.hora || 'Por confirmar'}
👨‍🏫 *Profesor:* ${profesorNombre}
💰 *Precio:* $${course.precio || 0}
🎫 *Método:* ${paymentMethod}

${tieneLinkDisponible ? `🔗 *Link de la clase:* ${linkCurso}` : ''}
${recursosTexto}

📞 *Soporte:* ${this.telefonoSoporte}
✉️ *Email:* ${this.correoSoporte}

¡Nos vemos en el curso! 🚀`;

      await this.sendWhatsApp(student.celular, mensaje);
      console.log(`✅ WhatsApp de inscripción enviado a: ${student.celular}`);
      return true;
    } catch (error) {
      console.error(
        `❌ Error enviando WhatsApp a ${student.celular}:`,
        error.message,
      );
      return null;
    }
  }

  private async sendAdminNotification(
    course: any,
    student: any,
    paymentMethod: string,
  ) {
    const asuntoAdmin = `Nuevo inscrito: ${course.titulo} (${paymentMethod})`;
    const mensajeAdmin = `
      <div style="font-family: Arial, sans-serif; color:#222;">
        <h2>Nuevo inscrito (${paymentMethod})</h2>
        <p><b>${student.nombres} ${student.apellidos}</b> (${student.correo}) se inscribió:</p>
        <ul>
          <li><b>Curso:</b> ${course.titulo}</li>
          <li><b>Fecha:</b> ${course.fecha ? new Date(course.fecha).toLocaleDateString() : 'Por confirmar'}</li>
          <li><b>Hora:</b> ${course.hora || 'Por confirmar'}</li>
          <li><b>Precio:</b> $${course.precio} (${paymentMethod})</li>
          <li><b>Contacto:</b> ${student.celular}</li>
          <li><b>Email:</b> ${student.correo}</li>
        </ul>
        <p><b>Timestamp:</b> ${new Date().toLocaleString()}</p>
      </div>
    `;

    // Enviar a todos los correos admin
    const destinatarios = new Set([
      this.notificacionesInscripciones,
      ...this.correosAdminExtra,
    ]);

    for (const email of destinatarios) {
      try {
        await this.mailService.sendMail(email, asuntoAdmin, mensajeAdmin);
      } catch (error) {
        console.error(`Error enviando notificación a ${email}:`, error);
      }
    }
  }

  // ✅ WhatsApp vía conexión Baileys (la del QR en Configuración) — ya NO usa WBOT/.env
  private async sendWhatsApp(celular: string, mensaje: string) {
    if (!celular) return;

    if (!this.whatsapp.getStatus().connected) {
      console.warn('⚠️ WhatsApp no conectado (escanea el QR en Configuración). Mensaje omitido.');
      return;
    }

    try {
      await this.whatsapp.sendText(celular, mensaje);
    } catch (error) {
      console.error(`Error enviando WhatsApp a ${celular}:`, error.message);
    }
  }
}
