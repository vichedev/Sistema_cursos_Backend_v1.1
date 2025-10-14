// src/payments/payments.controller.ts
import { Controller, Post, Body, UseGuards, BadRequestException, Logger, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { PayphoneService } from './payphone.service';
import { MailService } from '../common/mail.service';
import { CoursesService } from '../courses/courses.service';
import { UsersService } from '../users/users.service';
import { StudentCourse } from '../courses/student-course.entity';
import { PaymentAttempt } from './payment-attempt.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';
import { CouponsService } from '../coupons/coupons.service';
import { CouponUsage } from '../coupons/coupon-usage.entity';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  // ✅ VARIABLES DE CONFIGURACIÓN DESDE .env
  private readonly notificacionesInscripciones: string;
  private readonly alertasSistema: string;
  private readonly correoSoporte: string;
  private readonly telefonoSoporte: string;
  private readonly correosAdminExtra: string[];

  constructor(
    private payphoneService: PayphoneService,
    private mail: MailService,
    private coursesService: CoursesService,
    private usersService: UsersService,
    private configService: ConfigService,
    private couponsService: CouponsService,
    @InjectRepository(StudentCourse)
    private studentCourseRepo: Repository<StudentCourse>,
    @InjectRepository(PaymentAttempt)
    private paymentAttemptRepo: Repository<PaymentAttempt>,
    @InjectRepository(CouponUsage)
    private couponUsageRepo: Repository<CouponUsage>,
  ) {
    // ✅ INICIALIZAR CONFIGURACIÓN DESDE .env
    this.notificacionesInscripciones = this.configService.get<string>('NOTIFICACIONES_INSCRIPCIONES') || 'cursos@rednuevaconexion.net';
    this.alertasSistema = this.configService.get<string>('ALERTAS_SISTEMA') || 'cursos@rednuevaconexion.net';
    this.correoSoporte = this.configService.get<string>('CORREO_SOPORTE') || 'vzamora@maat.ec';
    this.telefonoSoporte = this.configService.get<string>('TELEFONO_SOPORTE') || '0986819378';

    // ✅ PROCESAR CORREOS EXTRA (separados por coma)
    const correosExtra = this.configService.get<string>('CORREOS_ADMIN_EXTRA');
    this.correosAdminExtra = correosExtra ? correosExtra.split(',').map(email => email.trim()) : [];

    this.logger.log(`📧 Configuración de correos cargada:
      - Notificaciones: ${this.notificacionesInscripciones}
      - Alertas: ${this.alertasSistema}
      - Soporte: ${this.correoSoporte}
      - Teléfono: ${this.telefonoSoporte}
      - Correos extra: ${this.correosAdminExtra.length}
    `);
  }

  // ===============================
  // ✅ MÉTODOS PRIVADOS DE APOYO
  // ===============================

  private async enviarWhatsapp(celular: string, mensaje: string) {
    if (!celular) {
      this.logger.warn('No se pudo enviar WhatsApp: número celular no definido');
      return;
    }

    const token = process.env.WHATSAPP_API_TOKEN;
    if (!token) {
      this.logger.error('No se pudo enviar WhatsApp: token no configurado en .env');
      return;
    }

    const numeroFormateado = celular.replace(/[^0-9]/g, '');
    const url = 'https://app.wbot.ec:443/backend/api/messages/send';
    const data = {
      number: numeroFormateado,
      body: mensaje,
      saveOnTicket: true,
      linkPreview: true,
    };

    try {
      await axios.post(url, data, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      this.logger.log(`Mensaje WhatsApp enviado a ${numeroFormateado}`);
    } catch (error) {
      this.logger.error(`Error enviando WhatsApp a ${numeroFormateado}: ${JSON.stringify(error.response?.data) || error.message}`);
    }
  }

  // ✅ MÉTODO MEJORADO PARA ENVIAR CORREOS A MÚLTIPLES DESTINATARIOS
  private async enviarCorreoAdmin(asunto: string, mensaje: string, tipo: 'alerta' | 'notificacion' = 'notificacion') {
    const destinatarios = new Set<string>();

    // Agregar destinatario principal según el tipo
    if (tipo === 'alerta') {
      destinatarios.add(this.alertasSistema);
    } else {
      destinatarios.add(this.notificacionesInscripciones);
    }

    // Agregar correos extra
    this.correosAdminExtra.forEach(email => destinatarios.add(email));

    // ✅ DEFINIR TIPO EXPLÍCITO PARA EL ARRAY
    interface ResultadoEnvio {
      email: string;
      success: boolean;
      error?: string;
    }

    const resultados: ResultadoEnvio[] = [];

    // Enviar a todos los destinatarios
    for (const email of destinatarios) {
      try {
        await this.mail.sendMail(email, asunto, mensaje);
        resultados.push({ email, success: true });
        this.logger.log(`✅ Correo enviado a: ${email}`);
      } catch (error) {
        resultados.push({
          email,
          success: false,
          error: error.message
        });
        this.logger.error(`❌ Error enviando a ${email}:`, error);
      }
    }

    return resultados;
  }

  // ✅ MÉTODO PARA ALERTAS AL ADMINISTRADOR
  private async enviarAlertaAdministrador(
    paymentAttempt: PaymentAttempt,
    tipoAlerta: string,
    detalles?: any
  ) {
    try {
      const curso = await this.coursesService.findById(paymentAttempt.cursoId);
      const estudiante = await this.usersService.findById(paymentAttempt.userId);

      const asunto = `🚨 ALERTA PAGO: ${tipoAlerta} - ${paymentAttempt.clientTransactionId}`;

      const mensaje = `
        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #fff3cd; border-left: 4px solid #ffc107;">
          <h2 style="color: #856404;">⚠️ Alerta de Sistema de Pagos</h2>
          
          <h3>Tipo de alerta: ${tipoAlerta}</h3>
          
          <h4>Información de la transacción:</h4>
          <ul>
            <li><b>Client Transaction ID:</b> ${paymentAttempt.clientTransactionId}</li>
            <li><b>Payphone ID:</b> ${paymentAttempt.payphoneId || 'N/A'}</li>
            <li><b>Estado actual:</b> ${paymentAttempt.status}</li>
            <li><b>Monto:</b> $${paymentAttempt.amount}</li>
            <li><b>Creado:</b> ${paymentAttempt.createdAt}</li>
          </ul>
          
          <h4>Información del estudiante:</h4>
          <ul>
            <li><b>Nombre:</b> ${estudiante?.nombres} ${estudiante?.apellidos}</li>
            <li><b>Email:</b> ${estudiante?.correo}</li>
            <li><b>Teléfono:</b> ${estudiante?.celular}</li>
          </ul>
          
          <h4>Información del curso:</h4>
          <ul>
            <li><b>Curso:</b> ${curso?.titulo}</li>
            <li><b>ID:</b> ${curso?.id}</li>
          </ul>
          
          ${detalles ? `
            <h4>Detalles adicionales:</h4>
            <pre style="background-color: #f8f9fa; padding: 10px; border-radius: 5px;">${JSON.stringify(detalles, null, 2)}</pre>
          ` : ''}
          
          <div style="margin-top: 20px; padding: 15px; background-color: #d1ecf1; border-radius: 5px;">
            <p><b>⚡ ACCIÓN REQUERIDA:</b></p>
            <ol>
              <li>Verificar el estado real en el panel de Payphone Business</li>
              <li>Si el pago está aprobado en Payphone, inscribir manualmente al estudiante</li>
              <li>Documentar la acción tomada</li>
            </ol>
          </div>
          
          <hr>
          <small>Alerta generada automáticamente - ${new Date().toLocaleString()}</small>
        </div>
      `;

      // ✅ USAR EL NUEVO MÉTODO PARA ENVIAR A MÚLTIPLES DESTINATARIOS
      const resultados = await this.enviarCorreoAdmin(asunto, mensaje, 'alerta');

      const whatsappMsg = `🚨 ALERTA PAGO: ${tipoAlerta}\n\nClientTxId: ${paymentAttempt.clientTransactionId}\nEstudiante: ${estudiante?.nombres}\nCurso: ${curso?.titulo}\nMonto: $${paymentAttempt.amount}\n\nREVISAR URGENTE en panel Payphone`;

      await this.enviarWhatsapp(this.telefonoSoporte, whatsappMsg);

      this.logger.log(`📧 Alertas enviadas a ${resultados.length} destinatarios: ${tipoAlerta}`);

    } catch (error) {
      this.logger.error('Error enviando alerta:', error);
    }
  }

  // ✅ MÉTODO MEJORADO PARA PROCESAR INSCRIPCIÓN
  private async procesarInscripcionExitosa(paymentAttempt: PaymentAttempt) {
    this.logger.log(`🔄 Procesando inscripción - PaymentAttempt ID: ${paymentAttempt.id}`);

    const course = await this.coursesService.findById(paymentAttempt.cursoId);
    const estudiante = await this.usersService.findById(paymentAttempt.userId);

    if (!course || !estudiante) {
      this.logger.error(`❌ Curso o estudiante no encontrado`);
      throw new Error('Curso o estudiante no encontrado');
    }

    // Protección contra doble inscripción
    const yaInscrito = await this.studentCourseRepo.findOne({
      where: { estudianteId: paymentAttempt.userId, cursoId: paymentAttempt.cursoId }
    });

    if (yaInscrito) {
      this.logger.warn(`⚠️ Usuario ya inscrito - Evitando duplicado`);

      await this.enviarAlertaAdministrador(paymentAttempt, 'DOBLE_INSCRIPCION_EVITADA', {
        mensaje: 'Usuario ya estaba inscrito',
        inscripcionExistente: yaInscrito.id
      });

      return;
    }

    // Verificar cupos
    if (course.cupos <= 0) {
      this.logger.error(`❌ SIN CUPOS pero pago aprobado`);

      await this.enviarAlertaAdministrador(paymentAttempt, 'SIN_CUPOS_PERO_PAGO_APROBADO', {
        mensaje: 'URGENTE: Cliente pagó pero no hay cupos',
        cursoId: course.id,
        cuposActuales: course.cupos
      });

      this.logger.warn(`⚠️ Inscribiendo de todas formas (cliente pagó)`);
    }

    // Procesar inscripción
    await this.coursesService.updateCupos(course.id, Math.max(0, course.cupos - 1));

    await this.studentCourseRepo.save({
      estudianteId: paymentAttempt.userId,
      cursoId: paymentAttempt.cursoId,
      pagado: true,
    });

    this.logger.log(`✅ Inscripción completada - Usuario: ${estudiante.correo}, Curso: ${course.titulo}`);

    // ✅ DETERMINAR MÉTODO DE PAGO PARA NOTIFICACIÓN
    let metodoPago = 'Payphone';
    if (paymentAttempt.status === 'GRATIS_CON_CUPON') {
      metodoPago = 'Cupón Gratis';
    } else if (paymentAttempt.amount < course.precio) {
      metodoPago = 'Payphone con Cupón';
    }

    await this.enviarNotificacionesInscripcion(course, estudiante, metodoPago);
  }

  // ✅ MÉTODO MEJORADO PARA ENVIAR NOTIFICACIONES
  private async enviarNotificacionesInscripcion(course: any, estudiante: any, metodoPago: string) {
    const profesorNombre = course.profesor ? `${course.profesor.nombres} ${course.profesor.apellidos}` : 'Por confirmar';
    const asignatura = course.profesor ? (course.profesor.asignatura || 'Por confirmar') : 'Por confirmar';

    let accesoMensaje = '';
    if (course.tipo && course.tipo.startsWith("ONLINE")) {
      accesoMensaje = `🔗 Enlace para la clase: ${course.link || 'Por confirmar'}`;
    } else if (course.link) {
      accesoMensaje = `📍 Ubicación: ${course.link}`;
    } else {
      accesoMensaje = '📍 Ubicación: Por confirmar';
    }

    const mensajeWhatsApp = `¡Inscripción confirmada!
Hola ${estudiante.nombres},
Te confirmamos tu inscripción al curso: ${course.titulo}.
Docente: ${profesorNombre}
Asignatura: ${asignatura}
Fecha: ${course.fecha ? new Date(course.fecha).toLocaleDateString() : 'Por confirmar'}
Hora: ${course.hora || 'Por confirmar'}
Precio: $${course.precio || 0}
Método: ${metodoPago}

${accesoMensaje}

¿Necesitas ayuda? Contáctanos:
📞 Soporte: ${this.telefonoSoporte}
✉️ Email: ${this.correoSoporte}

¡Nos vemos en el curso!`;

    try {
      // ✅ 1. CORREO AL ESTUDIANTE
      await this.mail.sendMail(
        estudiante.correo,
        'Confirmación de inscripción al curso',
        `
        <div style="font-family: Arial, sans-serif; color:#222;">
          <h2>¡Inscripción confirmada!</h2>
          <p>Hola <b>${estudiante.nombres}</b>,<br>
          Te confirmamos tu inscripción al siguiente curso:</p>
          <ul>
            <li><b>Curso:</b> ${course.titulo}</li>
            <li><b>Descripción:</b> ${course.descripcion}</li>
            <li><b>Fecha:</b> ${course.fecha ? new Date(course.fecha).toLocaleDateString() : 'Por confirmar'}</li>
            <li><b>Hora:</b> ${course.hora ? course.hora : 'Por confirmar'}</li>
            <li><b>Docente:</b> ${profesorNombre}</li>
            <li><b>Asignatura:</b> ${asignatura}</li>
            <li><b>Precio pagado:</b> $${course.precio || 0} (${metodoPago})</li>
            <li><b>Acceso:</b> ${course.tipo.startsWith("ONLINE")
          ? `<a href="${course.link}">Ir a la clase</a>`
          : `<a href="${course.link}">Ver ubicación en Google Maps</a>`
        }</li>
          </ul>
          
          <div style="margin-top: 20px; padding: 15px; background-color: #f5f5f5; border-radius: 5px;">
            <h3 style="margin-top: 0;">¿Necesitas ayuda?</h3>
            <p>Contáctanos por cualquier duda:</p>
            <ul>
              <li><b>📞 Teléfono:</b> ${this.telefonoSoporte}</li>
              <li><b>✉️ Email:</b> <a href="mailto:${this.correoSoporte}">${this.correoSoporte}</a></li>
            </ul>
          </div>
          
          <br>
          <p><i>¡Nos vemos en el curso!</i></p>
          <hr>
          <small>Sistema de Cursos MAAT</small>
        </div>
        `
      );

      // ✅ 2. WHATSAPP AL ESTUDIANTE
      await this.enviarWhatsapp(estudiante.celular, mensajeWhatsApp);

      // ✅ 3. NOTIFICACIÓN A ADMINISTRADORES (USANDO EL NUEVO MÉTODO)
      const asuntoAdmin = `Nuevo inscrito: ${course.titulo} (${metodoPago})`;
      const mensajeAdmin = `
        <div style="font-family: Arial, sans-serif; color:#222;">
          <h2>Nuevo inscrito (${metodoPago})</h2>
          <p><b>${estudiante.nombres} ${estudiante.apellidos}</b> (${estudiante.correo}) se inscribió:</p>
          <ul>
            <li><b>Curso:</b> ${course.titulo}</li>
            <li><b>Fecha:</b> ${course.fecha ? new Date(course.fecha).toLocaleDateString() : 'Por confirmar'}</li>
            <li><b>Hora:</b> ${course.hora || 'Por confirmar'}</li>
            <li><b>Docente:</b> ${profesorNombre}</li>
            <li><b>Precio:</b> $${course.precio} (${metodoPago})</li>
            <li><b>Contacto:</b> ${estudiante.celular}</li>
            <li><b>Email:</b> ${estudiante.correo}</li>
          </ul>
          <p><b>Timestamp:</b> ${new Date().toLocaleString()}</p>
        </div>
      `;

      await this.enviarCorreoAdmin(asuntoAdmin, mensajeAdmin, 'notificacion');

      this.logger.log(`📧 Notificaciones enviadas - Usuario: ${estudiante.correo}, Método: ${metodoPago}`);

    } catch (error) {
      this.logger.error(`Error enviando notificaciones:`, error);
    }
  }

  // ===============================
  // ✅ ENDPOINTS PÚBLICOS
  // ===============================

  @Post('create-payphone-payment')
  @UseGuards(JwtAuthGuard)
  async createPayphonePayment(@Body() body: { cursoId: number; userId: number }) {
    this.logger.log(`=== INICIO CREATE PAYPHONE PAYMENT ===`);
    this.logger.log(`Body recibido:`, body);

    try {
      if (!body.cursoId || !body.userId) {
        throw new BadRequestException('cursoId y userId son requeridos');
      }

      const course = await this.coursesService.findById(body.cursoId);
      this.logger.log(`Curso encontrado:`, course ? 'SÍ' : 'NO');

      if (!course) throw new BadRequestException('Curso no existe');
      if (course.cupos <= 0) throw new BadRequestException('No hay cupos disponibles');

      const yaInscrito = await this.studentCourseRepo.findOne({
        where: { estudianteId: body.userId, cursoId: body.cursoId }
      });
      this.logger.log(`Ya inscrito:`, yaInscrito ? 'SÍ' : 'NO');

      if (yaInscrito) throw new BadRequestException('Ya estás inscrito en este curso');

      const usuario = await this.usersService.findById(body.userId);
      this.logger.log(`Usuario encontrado:`, usuario ? 'SÍ' : 'NO');

      if (!usuario) throw new BadRequestException('Usuario no encontrado');

      const clientTransactionId = `CURSO-${body.cursoId}-${body.userId}-${Date.now()}-${uuidv4().substring(0, 8)}`;
      this.logger.log(`ClientTransactionId generado: ${clientTransactionId}`);

      const paymentAttempt = await this.paymentAttemptRepo.save({
        clientTransactionId,
        cursoId: body.cursoId,
        userId: body.userId,
        amount: course.precio,
        status: 'PENDIENTE'
      });
      this.logger.log(`PaymentAttempt guardado con ID: ${paymentAttempt.id}`);

      this.logger.log(`Creando pago Payphone para curso ${course.titulo} - Usuario: ${usuario.correo} - Monto: $${course.precio}`);

      const paymentData = await this.payphoneService.createPayment(
        course.precio,
        clientTransactionId,
        usuario.correo,
        {
          cursoId: body.cursoId,
          userId: body.userId,
          cursoTitulo: course.titulo,
          userData: {
            nombres: usuario.nombres,
            apellidos: usuario.apellidos,
            celular: usuario.celular,
            email: usuario.correo
          }
        }
      );

      this.logger.log(`Pago Payphone creado exitosamente - PaymentID: ${paymentData.paymentId}`);

      return {
        success: true,
        paymentUrl: paymentData.paymentUrl,
        paymentId: paymentData.paymentId,
        clientTransactionId: paymentData.clientTransactionId
      };

    } catch (error) {
      this.logger.error('ERROR EN CREATE PAYPHONE PAYMENT:', error);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        error.message || 'Error al crear el pago con Payphone'
      );
    }
  }

  @Post('create-payphone-payment-with-coupon')
  @UseGuards(JwtAuthGuard)
  async createPayphonePaymentWithCoupon(
    @Body() body: {
      cursoId: number;
      userId: number;
      codigoCupon: string;
    }
  ) {
    this.logger.log(`=== INICIO CREATE PAYPHONE PAYMENT WITH COUPON ===`);
    this.logger.log(`Body recibido:`, body);

    let reservationId: number | null = null;

    try {
      if (!body.cursoId || !body.userId || !body.codigoCupon) {
        throw new BadRequestException('cursoId, userId y codigoCupon son requeridos');
      }

      const course = await this.coursesService.findById(body.cursoId);
      this.logger.log(`Curso encontrado:`, course ? 'SÍ' : 'NO');

      if (!course) throw new BadRequestException('Curso no existe');
      if (course.cupos <= 0) throw new BadRequestException('No hay cupos disponibles');

      const yaInscrito = await this.studentCourseRepo.findOne({
        where: { estudianteId: body.userId, cursoId: body.cursoId }
      });
      this.logger.log(`Ya inscrito:`, yaInscrito ? 'SÍ' : 'NO');

      if (yaInscrito) throw new BadRequestException('Ya estás inscrito en este curso');

      const usuario = await this.usersService.findById(body.userId);
      this.logger.log(`Usuario encontrado:`, usuario ? 'SÍ' : 'NO');

      if (!usuario) throw new BadRequestException('Usuario no encontrado');

      // ✅ RESERVAR CUPÓN
      this.logger.log(`🔍 Reservando cupón: ${body.codigoCupon}`);
      const cuponReserva = await this.couponsService.reserveCoupon(
        body.cursoId,
        body.codigoCupon,
        body.userId
      );

      if (!cuponReserva.success) {
        throw new BadRequestException('Error al reservar cupón');
      }

      reservationId = cuponReserva.reservationId;
      this.logger.log(`📌 Cupón reservado - Reservation ID: ${reservationId}`);

      // ✅ CALCULAR PRECIO CON DESCUENTO
      const precioOriginal = course.precio;
      let precioConDescuento = precioOriginal;

      switch (cuponReserva.cupon.tipo) {
        case 'PORCENTAJE_10':  // ✅ AGREGAR ESTE CASO
          precioConDescuento = precioOriginal * 0.9;
          break;
        case 'PORCENTAJE_15':  // ✅ AGREGAR ESTE CASO
          precioConDescuento = precioOriginal * 0.85;
          break;
        case 'PORCENTAJE_30':
          precioConDescuento = precioOriginal * 0.7;
          break;
        case 'PORCENTAJE_50':
          precioConDescuento = precioOriginal * 0.5;
          break;
        case 'GRATIS':
          precioConDescuento = 0;
          break;
      }

      this.logger.log(`💰 Precios - Original: $${precioOriginal}, Con descuento: $${precioConDescuento}`);

      // ✅ SI ES GRATIS, CONFIRMAR INMEDIATAMENTE
      if (precioConDescuento === 0) {
        this.logger.log(`🎁 Cupón GRATIS detectado - Confirmando e inscribiendo directamente`);

        // Confirmar cupón
        await this.couponsService.confirmCouponUsage(reservationId);

        await this.coursesService.updateCupos(course.id, Math.max(0, course.cupos - 1));

        await this.studentCourseRepo.save({
          estudianteId: body.userId,
          cursoId: body.cursoId,
          pagado: true,
        });

        // Registrar payment attempt para tracking
        const clientTransactionId = `CUPON-GRATIS-${body.cursoId}-${body.userId}-${Date.now()}`;

        await this.paymentAttemptRepo.save({
          clientTransactionId,
          cursoId: body.cursoId,
          userId: body.userId,
          amount: 0,
          status: 'GRATIS_CON_CUPON',
          payphoneId: 'NO_PAYMENT_NEEDED',
          cuponReservaId: reservationId,
          callbackData: JSON.stringify({
            cupon: cuponReserva.cupon,
            mensaje: 'Inscripción gratuita mediante cupón'
          })
        });

        // ✅ ENVIAR NOTIFICACIONES (ESTA ES LA LÍNEA QUE FALTABA)
        await this.enviarNotificacionesInscripcion(course, usuario, 'Cupón Gratis');

        return {
          success: true,
          gratis: true,
          message: '¡Inscripción exitosa con cupón gratis!',
          cupon: cuponReserva.cupon,
          clientTransactionId
        };
      }

      // ✅ CREAR PAGO CON DESCUENTO
      const clientTransactionId = `CUPON-${body.cursoId}-${body.userId}-${Date.now()}-${uuidv4().substring(0, 8)}`;
      this.logger.log(`ClientTransactionId generado: ${clientTransactionId}`);

      const paymentAttempt = await this.paymentAttemptRepo.save({
        clientTransactionId,
        cursoId: body.cursoId,
        userId: body.userId,
        amount: precioConDescuento,
        status: 'PENDIENTE_CON_CUPON',
        cuponReservaId: reservationId
      });
      this.logger.log(`PaymentAttempt guardado con ID: ${paymentAttempt.id}`);

      this.logger.log(`Creando pago Payphone con cupón - Curso: ${course.titulo} - Monto: $${precioConDescuento}`);

      const paymentData = await this.payphoneService.createPayment(
        precioConDescuento,
        clientTransactionId,
        usuario.correo,
        {
          cursoId: body.cursoId,
          userId: body.userId,
          cursoTitulo: course.titulo,
          cupon: cuponReserva.cupon,
          precioOriginal: precioOriginal,
          descuentoAplicado: precioOriginal - precioConDescuento,
          userData: {
            nombres: usuario.nombres,
            apellidos: usuario.apellidos,
            celular: usuario.celular,
            email: usuario.correo
          }
        }
      );

      this.logger.log(`Pago Payphone con cupón creado exitosamente - PaymentID: ${paymentData.paymentId}`);

      return {
        success: true,
        gratis: false,
        paymentUrl: paymentData.paymentUrl,
        paymentId: paymentData.paymentId,
        clientTransactionId: paymentData.clientTransactionId,
        cupon: cuponReserva.cupon,
        precioOriginal,
        precioConDescuento,
        ahorro: precioOriginal - precioConDescuento,
        reservationId
      };

    } catch (error) {
      this.logger.error('ERROR EN CREATE PAYPHONE PAYMENT WITH COUPON:', error);

      // ✅ CANCELAR RESERVA SI HUBO ERROR
      if (reservationId) {
        try {
          await this.couponsService.cancelCouponReservation(reservationId);
          this.logger.log(`❌ Reserva cancelada por error: ${reservationId}`);
        } catch (cancelError) {
          this.logger.error(`Error cancelando reserva:`, cancelError);
        }
      }

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        error.message || 'Error al crear el pago con cupón'
      );
    }
  }

  @Get('payphone-confirm')
  async payphoneConfirm(
    @Query('id') id: string,
    @Query('clientTransactionId') clientTransactionId: string,
    @Res() res: Response
  ) {
    this.logger.log(`🔔 === CALLBACK PAYPHONE RECIBIDO ===`);
    this.logger.log(`ID: ${id}, ClientTransactionId: ${clientTransactionId}`);

    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';

    try {
      if (!id || !clientTransactionId) {
        this.logger.error('❌ Parámetros faltantes en callback');
        return res.redirect(`${frontendUrl}/pago-fallido?error=parametros_faltantes`);
      }

      // Buscar el PaymentAttempt
      const paymentAttempt = await this.paymentAttemptRepo.findOne({
        where: { clientTransactionId }
      });

      if (!paymentAttempt) {
        this.logger.error(`❌ PaymentAttempt no encontrado para: ${clientTransactionId}`);
        return res.redirect(`${frontendUrl}/pago-fallido?error=pago_no_encontrado`);
      }

      // ✅ PROTECCIÓN 1: Evitar doble procesamiento
      if (paymentAttempt.status === 'Approved' || paymentAttempt.status === 'GRATIS_CON_CUPON') {
        this.logger.warn(`⚠️ PAGO YA PROCESADO - ClientTxId: ${clientTransactionId}`);
        return res.redirect(`${frontendUrl}/pago-exitoso?clientTransactionId=${clientTransactionId}&already_processed=true`);
      }

      // ✅ PROTECCIÓN 2: Calcular tiempo transcurrido
      const tiempoTranscurrido = Date.now() - paymentAttempt.createdAt.getTime();
      const tiempoSegundos = Math.round(tiempoTranscurrido / 1000);

      // ✅ PROTECCIÓN 3: SIEMPRE verificar con Payphone
      this.logger.log(`🔐 Consultando estado REAL en Payphone...`);

      let confirmacionData;
      try {
        confirmacionData = await this.payphoneService.confirmTransaction(id, clientTransactionId);
      } catch (error) {
        this.logger.error(`💥 Error consultando Payphone:`, error);

        await this.paymentAttemptRepo.update(paymentAttempt.id, {
          status: 'PENDIENTE_VERIFICACION',
          callbackData: JSON.stringify({
            error: 'No se pudo verificar con Payphone',
            payphoneId: id,
            timestamp: new Date().toISOString(),
            errorDetails: error.message,
            tiempoSegundos
          })
        });

        // ✅ LIBERAR CUPÓN SI HAY RESERVA
        if (paymentAttempt.cuponReservaId) {
          try {
            await this.couponsService.cancelCouponReservation(paymentAttempt.cuponReservaId);
            this.logger.log(`🔄 Cupón liberado por error de verificación - Reserva ID: ${paymentAttempt.cuponReservaId}`);
          } catch (cuponError) {
            this.logger.error(`❌ Error liberando cupón en verificación:`, cuponError);
          }
        }

        // Alertar al administrador
        await this.enviarAlertaAdministrador(paymentAttempt, 'ERROR_VERIFICACION', {
          error: error.message,
          tiempoSegundos
        });

        return res.redirect(`${frontendUrl}/pago-pendiente?clientTransactionId=${clientTransactionId}`);
      }

      const estadoReal = confirmacionData.transactionStatus;
      this.logger.log(`✅ Estado REAL desde Payphone: ${estadoReal}`);

      // Actualizar con datos completos
      await this.paymentAttemptRepo.update(paymentAttempt.id, {
        payphoneId: id,
        status: estadoReal,
        callbackData: JSON.stringify({
          ...confirmacionData,
          tiempoProcesoSegundos: tiempoSegundos,
          verificadoEn: new Date().toISOString()
        }),
        updatedAt: new Date()
      });

      // ✅ PROCESAMIENTO SEGÚN ESTADO REAL
      if (estadoReal === 'Approved') {
        this.logger.log(`🎉 Pago APROBADO por Payphone`);

        // ✅ CONFIRMAR USO DEL CUPÓN SI EXISTE RESERVA
        if (paymentAttempt.cuponReservaId) {
          try {
            await this.couponsService.confirmCouponUsage(paymentAttempt.cuponReservaId);
            this.logger.log(`✅ Cupón confirmado después de pago exitoso - Reserva ID: ${paymentAttempt.cuponReservaId}`);
          } catch (error) {
            this.logger.error(`❌ Error confirmando cupón:`, error);
          }
        }

        // Procesar inscripción
        await this.procesarInscripcionExitosa(paymentAttempt);

        return res.redirect(`${frontendUrl}/pago-exitoso?clientTransactionId=${clientTransactionId}`);

      } else if (estadoReal === 'Canceled' || estadoReal === 'Rejected' || estadoReal === 'Expired' || estadoReal === 'Failed') {
        this.logger.warn(`❌ Pago fallido - Estado: ${estadoReal}`);

        // ✅ LIBERAR CUPÓN
        if (paymentAttempt.cuponReservaId) {
          try {
            await this.couponsService.cancelCouponReservation(paymentAttempt.cuponReservaId);
            this.logger.log(`🔄 Cupón liberado - Estado: ${estadoReal}, Reserva ID: ${paymentAttempt.cuponReservaId}`);
          } catch (error) {
            this.logger.error(`❌ Error liberando cupón:`, error);
          }
        }

        return res.redirect(`${frontendUrl}/pago-fallido?clientTransactionId=${clientTransactionId}&status=${estadoReal}`);

      } else {
        this.logger.warn(`⏳ Pago en estado: ${estadoReal}`);

        return res.redirect(`${frontendUrl}/pago-pendiente?clientTransactionId=${clientTransactionId}&status=${estadoReal}`);
      }

    } catch (error) {
      this.logger.error(`💥 Error CRÍTICO en callback:`, error);

      // ✅ EN CUALQUIER ERROR CRÍTICO, INTENTAR LIBERAR CUPÓN
      try {
        const paymentAttempt = await this.paymentAttemptRepo.findOne({
          where: { clientTransactionId }
        });

        if (paymentAttempt?.cuponReservaId) {
          await this.couponsService.cancelCouponReservation(paymentAttempt.cuponReservaId);
          this.logger.log(`🔄 Cupón liberado por error crítico - Reserva ID: ${paymentAttempt.cuponReservaId}`);
        }
      } catch (cuponError) {
        this.logger.error('Error liberando cupón en error crítico:', cuponError);
      }

      return res.redirect(`${frontendUrl}/pago-pendiente?error=error_procesamiento&clientTransactionId=${clientTransactionId}`);
    }
  }

  // ===============================
  // ✅ ENDPOINTS ADICIONALES (MANTENER TODOS)
  // ===============================

  @Post('release-coupon-reservation')
  @UseGuards(JwtAuthGuard)
  async releaseCouponReservation(
    @Body() body: {
      reservationId: number;
      userId: number;
    }
  ) {
    this.logger.log(`=== LIBERANDO RESERVA DE CUPÓN ===`);
    this.logger.log(`Body recibido:`, body);

    try {
      if (!body.reservationId || !body.userId) {
        throw new BadRequestException('reservationId y userId son requeridos');
      }

      const reservedUsage = await this.couponUsageRepo.findOne({
        where: {
          id: body.reservationId,
          userId: body.userId,
          estado: 'RESERVADO'
        }
      });

      if (!reservedUsage) {
        throw new BadRequestException('Reserva no encontrada o ya fue procesada');
      }

      await this.couponsService.cancelCouponReservation(body.reservationId);

      this.logger.log(`✅ Reserva liberada: ${body.reservationId} para usuario ${body.userId}`);

      return {
        success: true,
        message: 'Cupón liberado correctamente'
      };

    } catch (error) {
      this.logger.error('ERROR LIBERANDO RESERVA:', error);
      throw new BadRequestException(
        error.message || 'Error al liberar el cupón'
      );
    }
  }

  @Post('verify-coupon')
  @UseGuards(JwtAuthGuard)
  async verifyCoupon(
    @Body() body: {
      cursoId: number;
      userId: number;
      codigoCupon: string;
    }
  ) {
    try {
      if (!body.cursoId || !body.userId || !body.codigoCupon) {
        throw new BadRequestException('cursoId, userId y codigoCupon son requeridos');
      }

      const course = await this.coursesService.findById(body.cursoId);
      if (!course) {
        throw new BadRequestException('Curso no encontrado');
      }

      const verificationResult = await this.couponsService.verifyCoupon(
        body.cursoId,
        body.codigoCupon,
        body.userId
      );

      if (!verificationResult.valid || !verificationResult.cupon) {
        return {
          success: false,
          error: verificationResult.error || 'Error al verificar cupón'
        };
      }

      const precioOriginal = course.precio;
      let precioConDescuento = precioOriginal;

      switch (verificationResult.cupon.tipo) {
        case 'PORCENTAJE_10':  // ✅ AGREGAR ESTE CASO
          precioConDescuento = precioOriginal * 0.9;
          break;
        case 'PORCENTAJE_15':  // ✅ AGREGAR ESTE CASO
          precioConDescuento = precioOriginal * 0.85;
          break;
        case 'PORCENTAJE_30':
          precioConDescuento = precioOriginal * 0.7;
          break;
        case 'PORCENTAJE_50':
          precioConDescuento = precioOriginal * 0.5;
          break;
        case 'GRATIS':
          precioConDescuento = 0;
          break;
      }

      return {
        success: true,
        valid: true,
        cupon: verificationResult.cupon,
        precioOriginal,
        precioConDescuento,
        ahorro: precioOriginal - precioConDescuento,
        gratis: precioConDescuento === 0
      };

    } catch (error) {
      this.logger.error('Error verificando cupón:', error);
      return {
        success: false,
        error: error.message || 'Error al verificar cupón'
      };
    }
  }

  @Post('force-release-coupon')
  @UseGuards(JwtAuthGuard)
  async forceReleaseCoupon(
    @Body() body: {
      codigoCupon: string;
      userId: number;
      cursoId: number;
    }
  ) {
    this.logger.log(`=== FORZANDO LIBERACIÓN DE CUPÓN ===`);
    this.logger.log(`Body recibido:`, body);

    try {
      if (!body.codigoCupon || !body.userId || !body.cursoId) {
        throw new BadRequestException('codigoCupon, userId y cursoId son requeridos');
      }

      const result = await this.couponsService.forceReleaseCoupon(
        body.codigoCupon,
        body.userId,
        body.cursoId
      );

      return result;

    } catch (error) {
      this.logger.error('ERROR FORZANDO LIBERACIÓN:', error);
      throw new BadRequestException(
        error.message || 'Error al forzar liberación del cupón'
      );
    }
  }

  @Post('release-coupon-by-transaction')
  @UseGuards(JwtAuthGuard)
  async releaseCouponByTransaction(
    @Body() body: {
      clientTransactionId: string;
      userId: number;
    }
  ) {
    this.logger.log(`=== LIBERANDO CUPÓN POR TRANSACCIÓN ===`);
    this.logger.log(`Body recibido:`, body);

    try {
      if (!body.clientTransactionId || !body.userId) {
        throw new BadRequestException('clientTransactionId y userId son requeridos');
      }

      const paymentAttempt = await this.paymentAttemptRepo.findOne({
        where: {
          clientTransactionId: body.clientTransactionId,
          userId: body.userId
        }
      });

      if (!paymentAttempt) {
        throw new BadRequestException('Transacción no encontrada');
      }

      if (paymentAttempt.cuponReservaId) {
        await this.couponsService.cancelCouponReservation(paymentAttempt.cuponReservaId);
        this.logger.log(`✅ Cupón liberado - Reservation ID: ${paymentAttempt.cuponReservaId}`);
      }

      return {
        success: true,
        message: 'Cupón liberado correctamente'
      };

    } catch (error) {
      this.logger.error('ERROR LIBERANDO CUPÓN POR TRANSACCIÓN:', error);
      throw new BadRequestException(
        error.message || 'Error al liberar el cupón'
      );
    }
  }

  @Post('inscribir-gratis')
  @UseGuards(JwtAuthGuard)
  async inscribirGratis(@Body() body: { cursoId: number; userId: number }) {
    const course = await this.coursesService.findById(body.cursoId);
    if (!course) throw new BadRequestException('Curso no existe');
    if (course.cupos <= 0) throw new BadRequestException('No hay cupos disponibles');

    const yaInscrito = await this.studentCourseRepo.findOne({
      where: { estudianteId: body.userId, cursoId: body.cursoId }
    });
    if (yaInscrito) throw new BadRequestException('Ya estás inscrito en este curso');

    await this.coursesService.updateCupos(course.id, course.cupos - 1);

    await this.studentCourseRepo.save({
      estudianteId: body.userId,
      cursoId: body.cursoId,
      pagado: true,
    });

    const estudiante = await this.usersService.findById(body.userId);
    if (estudiante) {
      await this.enviarNotificacionesInscripcion(course, estudiante, 'Gratis');
    }
    return { success: true, message: 'Inscrito correctamente' };
  }

  @Get('check-payment-status')
  @UseGuards(JwtAuthGuard)
  async checkPaymentStatus(
    @Query('clientTransactionId') clientTransactionId: string
  ) {
    try {
      if (!clientTransactionId) {
        throw new BadRequestException('clientTransactionId es requerido');
      }

      const paymentAttempt = await this.paymentAttemptRepo.findOne({
        where: { clientTransactionId }
      });

      if (!paymentAttempt) {
        return { success: false, error: 'Pago no encontrado' };
      }

      return {
        success: paymentAttempt.status === 'Approved' || paymentAttempt.status === 'GRATIS_CON_CUPON',
        status: paymentAttempt.status,
        paymentId: paymentAttempt.payphoneId,
        clientTransactionId: paymentAttempt.clientTransactionId,
        amount: paymentAttempt.amount
      };

    } catch (error) {
      this.logger.error(`Error verificando pago:`, error);
      return { success: false, error: 'Error verificando estado del pago' };
    }
  }

  @Get('debug-payment')
  async debugPayment(@Query('clientTransactionId') clientTransactionId: string) {
    try {
      const paymentAttempt = await this.paymentAttemptRepo.findOne({
        where: { clientTransactionId }
      });

      if (!paymentAttempt) {
        return { success: false, error: 'No encontrado' };
      }

      return {
        success: true,
        data: paymentAttempt,
        callbackData: paymentAttempt.callbackData ? JSON.parse(paymentAttempt.callbackData) : null
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  @Post('cleanup-expired-reservations')
  @UseGuards(JwtAuthGuard)
  async cleanupExpiredReservations() {
    try {
      await this.couponsService.cleanupExpiredReservations();
      return { success: true, message: 'Limpieza de reservas expiradas completada' };
    } catch (error) {
      this.logger.error('Error en limpieza de reservas:', error);
      throw new BadRequestException('Error al limpiar reservas expiradas');
    }
  }

  @Get('config-correos')
  @UseGuards(JwtAuthGuard)
  async verificarConfiguracionCorreos() {
    return {
      notificacionesInscripciones: this.notificacionesInscripciones,
      alertasSistema: this.alertasSistema,
      correoSoporte: this.correoSoporte,
      telefonoSoporte: this.telefonoSoporte,
      correosAdminExtra: this.correosAdminExtra,
      entorno: this.configService.get('NODE_ENV')
    };
  }
}