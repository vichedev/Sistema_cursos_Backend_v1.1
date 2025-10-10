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

  // ✅ ENDPOINT PRINCIPAL MEJORADO - CON PROTECCIONES
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
      if (paymentAttempt.status === 'Approved') {
        this.logger.warn(`⚠️ PAGO YA PROCESADO - ClientTxId: ${clientTransactionId}`);
        return res.redirect(`${frontendUrl}/pago-exitoso?clientTransactionId=${clientTransactionId}&already_processed=true`);
      }

      // ✅ PROTECCIÓN 2: Calcular tiempo transcurrido
      const tiempoTranscurrido = Date.now() - paymentAttempt.createdAt.getTime();
      const tiempoSegundos = Math.round(tiempoTranscurrido / 1000);

      // ✅ PROTECCIÓN 3: SIEMPRE verificar con Payphone (no confiar solo en tiempo)
      this.logger.log(`🔐 Consultando estado REAL en Payphone...`);
      
      let confirmacionData;
      try {
        confirmacionData = await this.payphoneService.confirmTransaction(id, clientTransactionId);
      } catch (error) {
        this.logger.error(`💥 Error consultando Payphone:`, error);
        
        // CRÍTICO: Si no podemos confirmar, marcar como pendiente (NO cancelar)
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

        // Alertar al administrador
        await this.enviarAlertaAdministrador(paymentAttempt, 'ERROR_VERIFICACION', {
          error: error.message,
          tiempoSegundos
        });

        return res.redirect(`${frontendUrl}/pago-pendiente?clientTransactionId=${clientTransactionId}`);
      }

      const estadoReal = confirmacionData.transactionStatus;
      this.logger.log(`✅ Estado REAL desde Payphone: ${estadoReal}`);

      // Logging detallado
      this.logger.log(`📊 DETALLES DE TRANSACCIÓN:`, {
        transactionId: confirmacionData.transactionId,
        authorizationCode: confirmacionData.authorizationCode,
        estadoPayphone: estadoReal,
        tiempoProcesoSeg: tiempoSegundos,
        cardBrand: confirmacionData.cardBrand,
        lastDigits: confirmacionData.lastDigits,
        amount: confirmacionData.amount,
        date: confirmacionData.date
      });

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
        
        // Verificar si tardó más de 5 minutos
        if (tiempoSegundos > 300) {
          this.logger.warn(`⚠️ CASO ESPECIAL: Pago aprobado después de 5 minutos (${tiempoSegundos}s)`);
          this.logger.warn(`   Payphone SÍ cobró, procesando inscripción...`);
          
          await this.enviarAlertaAdministrador(paymentAttempt, 'APROBADO_TARDIO', {
            tiempoSegundos,
            mensaje: 'Pago procesado exitosamente pero tardó más de 5 minutos'
          });
        }

        // Procesar inscripción
        await this.procesarInscripcionExitosa(paymentAttempt);
        
        return res.redirect(`${frontendUrl}/pago-exitoso?clientTransactionId=${clientTransactionId}`);
        
      } else if (estadoReal === 'Canceled' || estadoReal === 'Rejected') {
        this.logger.warn(`❌ Pago rechazado/cancelado - Estado: ${estadoReal}`);
        return res.redirect(`${frontendUrl}/pago-fallido?clientTransactionId=${clientTransactionId}&status=${estadoReal}`);
        
      } else if (estadoReal === 'Pending') {
        this.logger.warn(`⏳ Pago PENDIENTE en Payphone`);
        
        await this.enviarAlertaAdministrador(paymentAttempt, 'PENDIENTE_LARGO', {
          tiempoSegundos,
          mensaje: 'Transacción sigue pendiente después de callback'
        });
        
        return res.redirect(`${frontendUrl}/pago-pendiente?clientTransactionId=${clientTransactionId}`);
        
      } else {
        this.logger.error(`⚠️ Estado desconocido: ${estadoReal}`);
        
        await this.enviarAlertaAdministrador(paymentAttempt, 'ESTADO_DESCONOCIDO', {
          estadoReal,
          mensaje: 'Requiere revisión manual urgente'
        });
        
        return res.redirect(`${frontendUrl}/pago-pendiente?clientTransactionId=${clientTransactionId}&unknown_status=true`);
      }

    } catch (error) {
      this.logger.error(`💥 Error CRÍTICO en callback:`, error);
      
      try {
        await this.paymentAttemptRepo.update(
          { clientTransactionId },
          {
            status: 'ERROR_CRITICO',
            callbackData: JSON.stringify({
              error: error.message,
              stack: error.stack,
              timestamp: new Date().toISOString()
            })
          }
        );
      } catch (dbError) {
        this.logger.error('Error guardando en BD:', dbError);
      }
      
      return res.redirect(`${frontendUrl}/pago-pendiente?error=error_procesamiento&clientTransactionId=${clientTransactionId}`);
    }
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

      await this.mail.sendMail('cursos@rednuevaconexion.net', asunto, mensaje);

      const whatsappMsg = `🚨 ALERTA PAGO: ${tipoAlerta}\n\nClientTxId: ${paymentAttempt.clientTransactionId}\nEstudiante: ${estudiante?.nombres}\nCurso: ${curso?.titulo}\nMonto: $${paymentAttempt.amount}\n\nREVISAR URGENTE en panel Payphone`;
      
      await this.enviarWhatsapp('0986819378', whatsappMsg);

      this.logger.log(`📧 Alerta enviada al administrador: ${tipoAlerta}`);
      
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

    await this.enviarNotificacionesInscripcion(course, estudiante, 'Payphone');
  }

  // Método para enviar notificaciones
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

${accesoMensaje}

¿Necesitas ayuda? Contáctanos:
📞 Soporte: 0986819378
✉️ Email: vzamora@maat.ec

¡Nos vemos en el curso!`;

    try {
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
            <p>Contáctanos por cualquier duda:</p>
            <ul>
              <li><b>📞 Teléfono:</b> 0986819378</li>
              <li><b>✉️ Email:</b> <a href="mailto:vzamora@maat.ec">vzamora@maat.ec</a></li>
            </ul>
          </div>
          
          <br>
          <p><i>¡Nos vemos en el curso!</i></p>
          <hr>
          <small>Sistema de Cursos MAAT</small>
        </div>
        `
      );

      await this.enviarWhatsapp(estudiante.celular, mensajeWhatsApp);

      await this.mail.sendMail(
        'cursos@rednuevaconexion.net',
        `Nuevo inscrito: ${course.titulo}`,
        `
        <div style="font-family: Arial, sans-serif; color:#222;">
          <h2>Nuevo inscrito (compra)</h2>
          <p><b>${estudiante.nombres} ${estudiante.apellidos}</b> (${estudiante.correo}) se inscribió:</p>
          <ul>
            <li><b>Curso:</b> ${course.titulo}</li>
            <li><b>Fecha:</b> ${course.fecha ? new Date(course.fecha).toLocaleDateString() : 'Por confirmar'}</li>
            <li><b>Hora:</b> ${course.hora || 'Por confirmar'}</li>
            <li><b>Docente:</b> ${profesorNombre}</li>
            <li><b>Precio:</b> $${course.precio} (${metodoPago})</li>
            <li><b>Contacto:</b> ${estudiante.celular}</li>
          </ul>
        </div>
        `
      );

      this.logger.log(`📧 Notificaciones enviadas - Usuario: ${estudiante.correo}`);
    } catch (error) {
      this.logger.error(`Error enviando notificaciones:`, error);
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
        success: paymentAttempt.status === 'Approved',
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
}