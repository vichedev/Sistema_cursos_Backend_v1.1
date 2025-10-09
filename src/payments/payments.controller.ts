// src/payments/payments.controller.ts
import { Controller, Post, Body, UseGuards, BadRequestException, Logger, Get, Query, Res, Req } from '@nestjs/common';
import { Response, Request } from 'express';
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

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private payphoneService: PayphoneService,
    private mail: MailService,
    private coursesService: CoursesService,
    private usersService: UsersService,
    private configService: ConfigService,
    @InjectRepository(StudentCourse)
    private studentCourseRepo: Repository<StudentCourse>,
    @InjectRepository(PaymentAttempt)
    private paymentAttemptRepo: Repository<PaymentAttempt>,
  ) { }

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
          // ✅ AGREGAR DATOS DEL USUARIO PARA CAMPOS OPCIONALES
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

  // Endpoint principal para manejar redirección de Payphone
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

      // ✅ === MEJORA 1: DETECCIÓN DE REVERSO AUTOMÁTICO ===
      const tiempoTranscurrido = Date.now() - paymentAttempt.createdAt.getTime();
      const cincoMinutosEnMs = 5 * 60 * 1000;

      if (tiempoTranscurrido > cincoMinutosEnMs) {
        this.logger.warn(`⏰ DETECTADO: Posible reverso automático de Payphone`);
        this.logger.warn(`   Tiempo transcurrido: ${Math.round(tiempoTranscurrido / 1000)} segundos`);

        // Solo registrar - Payphone YA reversó el dinero automáticamente
        await this.paymentAttemptRepo.update(paymentAttempt.id, {
          status: 'REVERSADO_AUTOMATICO',
          callbackData: JSON.stringify({
            motivo: 'Payphone reversó automáticamente (timeout >5min)',
            tiempoTranscurridoSeg: Math.round(tiempoTranscurrido / 1000),
            nota: 'El dinero fue devuelto al cliente por Payphone Business'
          })
        });

        return res.redirect(`${frontendUrl}/pago-fallido?error=timeout_reverso&clientTransactionId=${clientTransactionId}`);
      }
      // ✅ === FIN MEJORA 1 ===

      // Confirmar transacción con Payphone usando API oficial
      this.logger.log(`🔐 Realizando confirmación oficial con Payphone...`);
      const confirmacionData = await this.payphoneService.confirmTransaction(id, clientTransactionId);

      const estadoReal = confirmacionData.transactionStatus;
      this.logger.log(`✅ Estado real desde confirmación: ${estadoReal}`);

      // ✅ === MEJORA 2: MEJOR LOGGING ===
      this.logger.log(`📊 DETALLES DE TRANSACCIÓN:`, {
        transactionId: confirmacionData.transactionId,
        authorizationCode: confirmacionData.authorizationCode,
        cardBrand: confirmacionData.cardBrand,
        lastDigits: confirmacionData.lastDigits,
        amount: confirmacionData.amount,
        date: confirmacionData.date,
        tiempoProcesoSeg: Math.round(tiempoTranscurrido / 1000)
      });
      // ✅ === FIN MEJORA 2 ===

      // Actualizar PaymentAttempt con datos completos
      await this.paymentAttemptRepo.update(paymentAttempt.id, {
        payphoneId: id,
        status: estadoReal,
        callbackData: JSON.stringify(confirmacionData),
        updatedAt: new Date()
      });

      this.logger.log(`✅ Transacción confirmada oficialmente - ${clientTransactionId}: ${estadoReal}`);

      // Procesar según el estado
      if (estadoReal === 'Approved') {
        this.logger.log(`🎉 Pago aprobado - Procesando inscripción`);
        await this.procesarInscripcionExitosa(paymentAttempt);
        return res.redirect(`${frontendUrl}/pago-exitoso?clientTransactionId=${clientTransactionId}`);
      } else if (estadoReal === 'Canceled') {
        this.logger.warn(`❌ Pago cancelado - Estado: ${estadoReal}`);
        return res.redirect(`${frontendUrl}/pago-fallido?clientTransactionId=${clientTransactionId}&status=canceled`);
      } else {
        this.logger.warn(`⏸️  Pago con estado desconocido: ${estadoReal}`);
        return res.redirect(`${frontendUrl}/pago-fallido?clientTransactionId=${clientTransactionId}&status=${estadoReal}`);
      }

    } catch (error) {
      this.logger.error(`💥 Error en callback Payphone:`, error);
      return res.redirect(`${frontendUrl}/pago-fallido?error=error_procesamiento`);
    }
  }

  // Método auxiliar para procesar inscripción exitosa
  private async procesarInscripcionExitosa(paymentAttempt: PaymentAttempt) {
    this.logger.log(`🔄 Iniciando procesamiento de inscripción para PaymentAttempt ID: ${paymentAttempt.id}`);

    const course = await this.coursesService.findById(paymentAttempt.cursoId);
    const estudiante = await this.usersService.findById(paymentAttempt.userId);

    if (!course || !estudiante) {
      this.logger.error(`❌ Curso o estudiante no encontrado - Curso: ${!!course}, Estudiante: ${!!estudiante}`);
      throw new Error('Curso o estudiante no encontrado');
    }

    // Verificar que no esté ya inscrito (doble verificación)
    const yaInscrito = await this.studentCourseRepo.findOne({
      where: { estudianteId: paymentAttempt.userId, cursoId: paymentAttempt.cursoId }
    });

    if (yaInscrito) {
      this.logger.warn(`⚠️ Usuario ${paymentAttempt.userId} ya inscrito en curso ${paymentAttempt.cursoId} - Evitando duplicado`);
      return;
    }

    // Procesar inscripción
    await this.coursesService.updateCupos(course.id, course.cupos - 1);
    await this.studentCourseRepo.save({
      estudianteId: paymentAttempt.userId,
      cursoId: paymentAttempt.cursoId,
      pagado: true,
    });

    this.logger.log(`✅ Inscripción completada - Usuario: ${estudiante.correo}, Curso: ${course.titulo}`);

    // Enviar notificaciones
    await this.enviarNotificacionesInscripcion(course, estudiante, 'Payphone');
  }

  // Método para enviar notificaciones
  private async enviarNotificacionesInscripcion(course: any, estudiante: any, metodoPago: string) {
    const profesorNombre = course.profesor ? `${course.profesor.nombres} ${course.profesor.apellidos}` : 'Por confirmar';
    const asignatura = course.profesor ? (course.profesor.asignatura || 'Por confirmar') : 'Por confirmar';

    // Determinar el tipo de acceso y preparar el mensaje correspondiente
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

${accesoMensaje}

¿Necesitas ayuda? Contáctanos:
📞 Soporte: 0986819378
✉️ Email: vzamora@maat.ec

¡Nos vemos en el curso!`;

    try {
      // Enviar email al estudiante
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
            <li><b>Precio pagado:</b> $${course.precio || 0} (Transacción ${metodoPago})</li>
            <li><b>Acceso:</b> ${course.tipo.startsWith("ONLINE")
          ? `<a href="${course.link}">Ir a la clase</a>`
          : `<a href="${course.link}">Ver ubicación en Google Maps</a>`
        }</li>
          </ul>
          
          <div style="margin-top: 20px; padding: 15px; background-color: #f5f5f5; border-radius: 5px;">
            <h3 style="margin-top: 0;">¿Necesitas ayuda?</h3>
            <p>Contáctanos por cualquier duda o inconveniente:</p>
            <ul>
              <li><b>📞 Teléfono de soporte:</b> 0986819378</li>
              <li><b>✉️ Email de soporte:</b> <a href="mailto:vzamora@maat.ec">vzamora@maat.ec</a></li>
            </ul>
          </div>
          
          <br>
          <p><i>¡Nos vemos en el curso!</i></p>
          <hr>
          <small>Este correo fue generado automáticamente por el sistema de Cursos MAAT.</small>
        </div>
        `
      );

      // Enviar WhatsApp
      await this.enviarWhatsapp(estudiante.celular, mensajeWhatsApp);

      // Notificar al administrador
      await this.mail.sendMail(
        'cursos@rednuevaconexion.net',
        `Nuevo inscrito en el curso: ${course.titulo}`,
        `
        <div style="font-family: Arial, sans-serif; color:#222;">
          <h2>Nuevo inscrito (compra)</h2>
          <p>El usuario <b>${estudiante.nombres} ${estudiante.apellidos}</b> (${estudiante.correo}) se inscribió en el curso pagado:</p>
          <ul>
            <li><b>Curso:</b> ${course.titulo}</li>
            <li><b>Fecha:</b> ${course.fecha ? new Date(course.fecha).toLocaleDateString() : 'Por confirmar'}</li>
            <li><b>Hora:</b> ${course.hora || 'Por confirmar'}</li>
            <li><b>Docente:</b> ${profesorNombre}</li>
            <li><b>Asignatura:</b> ${asignatura}</li>
            <li><b>Precio:</b> $${course.precio} (${metodoPago})</li>
            <li><b>Contacto estudiante:</b> ${estudiante.celular}</li>
            <li><b>Enlace proporcionado:</b> ${course.link || 'No disponible'}</li>
          </ul>
          
          <div style="margin-top: 20px; padding: 15px; background-color: #f9f9f9; border-left: 4px solid #4CAF50;">
            <p><b>Información de contacto para el estudiante:</b></p>
            <p>Se ha proporcionado al estudiante los siguientes datos de soporte:</p>
            <ul>
              <li><b>Soporte telefónico:</b> 0986819378</li>
              <li><b>Email de soporte:</b> vzamora@maat.ec</li>
            </ul>
          </div>
          
          <hr>
          <small>Este correo fue generado automáticamente por el sistema de Cursos MAAT.</small>
        </div>
        `
      );

      this.logger.log(`📧 Notificaciones enviadas exitosamente para inscripción - Usuario: ${estudiante.correo}`);
    } catch (error) {
      this.logger.error(`💥 Error enviando notificaciones para usuario ${estudiante.correo}:`, error);
    }
  }

  // Endpoint para inscripción gratuita
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

  // Endpoint para verificar estado de pago
  @Get('check-payment-status')
  @UseGuards(JwtAuthGuard)
  async checkPaymentStatus(
    @Query('paymentId') paymentId: string,
    @Query('clientTransactionId') clientTransactionId: string
  ) {
    try {
      this.logger.log(`🔍 Verificando estado de pago - ClientTxId: ${clientTransactionId}`);

      if (!clientTransactionId) {
        throw new BadRequestException('clientTransactionId es requerido');
      }

      const paymentAttempt = await this.paymentAttemptRepo.findOne({
        where: { clientTransactionId }
      });

      if (!paymentAttempt) {
        this.logger.error(`❌ PaymentAttempt no encontrado para clientTransactionId: ${clientTransactionId}`);
        return { success: false, error: 'Pago no encontrado' };
      }

      this.logger.log(`✅ Estado del pago encontrado: ${paymentAttempt.status}`);

      return {
        success: paymentAttempt.status === 'Approved',
        status: paymentAttempt.status,
        paymentId: paymentAttempt.payphoneId,
        clientTransactionId: paymentAttempt.clientTransactionId,
        amount: paymentAttempt.amount
      };

    } catch (error) {
      this.logger.error(`💥 Error verificando estado de pago ${clientTransactionId}:`, error);
      return { success: false, error: 'Error verificando estado del pago' };
    }
  }

  // Endpoint para historial de pagos
  @Get('payment-history')
  @UseGuards(JwtAuthGuard)
  async getPaymentHistory(@Query('userId') userId: number) {
    try {
      const payments = await this.paymentAttemptRepo.find({
        where: { userId },
        order: { createdAt: 'DESC' }
      });
      return { success: true, payments };
    } catch (error) {
      this.logger.error(`💥 Error obteniendo historial de pagos para usuario ${userId}:`, error);
      return { success: false, error: 'Error obteniendo historial' };
    }
  }

  // Endpoint para debug
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

  // Limpieza de pagos expirados
  @Post('cleanup-expired-payments')
  async cleanupExpiredPayments() {
    try {
      const cincoMinutosAtras = new Date(Date.now() - (5 * 60 * 1000));

      const expiredPayments = await this.paymentAttemptRepo
        .createQueryBuilder('payment')
        .where('payment.status = :status', { status: 'PENDIENTE' })
        .andWhere('payment.createdAt < :date', { date: cincoMinutosAtras })
        .getMany();

      for (const payment of expiredPayments) {
        await this.paymentAttemptRepo.update(payment.id, {
          status: 'EXPIRADO',
          callbackData: JSON.stringify({
            motivo: 'Expirado por inactividad (>5min)',
            expiradoEl: new Date().toISOString()
          })
        });
      }

      this.logger.log(`🧹 Limpieza completada: ${expiredPayments.length} transacciones expiradas`);
      return {
        success: true,
        cleaned: expiredPayments.length
      };

    } catch (error) {
      this.logger.error('💥 Error en limpieza de transacciones:', error);
      return { success: false, error: error.message };
    }
  }

}