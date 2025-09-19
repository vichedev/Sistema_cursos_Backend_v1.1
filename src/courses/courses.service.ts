// src/courses/courses.service.ts
import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Course } from './course.entity';
import { StudentCourse } from './student-course.entity';
import { PaymentAttempt } from '../payments/payment-attempt.entity';
import { UsersService } from '../users/users.service';
import { MailService } from '../common/mail.service';
import { User } from '../users/user.entity';
import axios from 'axios';

// ✅ importar el SERVICE SSE (no controller)
import { NotificationsSseService } from '../notifications/notifications.sse.service';

@Injectable()
export class CoursesService {
  private readonly logger = new Logger(CoursesService.name);

  constructor(
    @InjectRepository(Course) private repo: Repository<Course>,
    @InjectRepository(StudentCourse) private studentCourseRepo: Repository<StudentCourse>,
    @InjectRepository(PaymentAttempt) private paymentAttemptRepo: Repository<PaymentAttempt>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private usersService: UsersService,
    private mail: MailService,
    // ✅ inyecta el servicio SSE
    private readonly sse: NotificationsSseService,
  ) {}

  // ===============================
  // CREAR CURSO + Notificación en segundo plano
  // ===============================
  async create(data: any) {
    const course = this.repo.create(data);
    const result = await this.repo.save(course);

    let courseId: number;
    if (Array.isArray(result)) {
      if (result.length > 0 && result[0].id) {
        courseId = result[0].id;
      } else {
        throw new Error('Error al guardar el curso: resultado vacío');
      }
    } else if (result && typeof result === 'object' && 'id' in result) {
      courseId = (result as Course).id;
    } else {
      throw new Error('Error al guardar el curso: formato inesperado');
    }

    const notificarCorreo = data.notificarCorreo === 'true' || data.notificarCorreo === true;
    const notificarWhatsapp = data.notificarWhatsapp === 'true' || data.notificarWhatsapp === true;

    if (notificarCorreo || notificarWhatsapp) {
      // no esperar
      this.notifyAllStudentsBackground(courseId, notificarCorreo, notificarWhatsapp)
        .catch((err) =>
          this.logger.error(`Error en notificación en segundo plano: ${err.message}`),
        );
    }

    return this.findById(courseId);
  }

  // ===============================
  // Notificar en segundo plano con lotes + SSE
  // ===============================
  private async notifyAllStudentsBackground(
    courseId: number,
    correo: boolean,
    whatsapp: boolean,
  ) {
    try {
      const course = await this.findById(courseId);
      if (!course) {
        this.logger.error(`Curso ${courseId} no encontrado para notificación`);
        return;
      }

      const estudiantes = await this.userRepo.find({ where: { rol: 'ESTUDIANTE' } });
      const total = estudiantes.length;

      // ▶️ START (una tarjeta por curso)
      this.sse.emitStart(courseId, course.titulo, total);

      this.logger.log(`📢 Programando notificaciones para ${total} estudiantes`);

      if (total === 0) {
        this.sse.emitDone(courseId);
        this.logger.log(`✅ Notificaciones (0) completadas para el curso: ${course.titulo}`);
        return;
      }

      let completed = 0;
      const batchSize = 10;
      const delayBetweenBatches = 2 * 60 * 1000; // 2 minutos
      const totalBatches = Math.ceil(total / batchSize);

      for (let i = 0; i < total; i += batchSize) {
        const batch = estudiantes.slice(i, i + batchSize);
        const batchIndex = i / batchSize;

        setTimeout(async () => {
          this.logger.log(`⏰ Procesando lote ${batchIndex + 1} de ${totalBatches}`);

          for (const est of batch) {
            try {
              if (correo) await this.sendEmailNotification(est, course);
              if (whatsapp && est.celular) await this.sendWhatsAppNotification(est, course);
            } catch (err) {
              this.logger.error(`❌ Error notificando a ${est.correo}: ${err.message}`);
            } finally {
              completed = Math.min(completed + 1, total);
              // ▶️ PROGRESS
              this.sse.emitProgress(courseId, completed, total);

              await new Promise((r) => setTimeout(r, 500));

              if (completed === total) {
                // ▶️ DONE
                this.sse.emitDone(courseId);
                this.logger.log(`✅ Notificaciones completadas para el curso: ${course.titulo}`);
              }
            }
          }
        }, batchIndex * delayBetweenBatches);
      }
    } catch (err) {
      this.logger.error(`Error en notificación en segundo plano: ${err.message}`);
    }
  }

  // ===============================
  // Métodos auxiliares para notificaciones
  // ===============================
  private async sendEmailNotification(student: User, course: Course) {
    await this.mail.sendMail(
      student.correo,
      `📚 Nuevo curso disponible: ${course.titulo}`,
      `
        <div style="font-family: Arial, sans-serif; color: #222; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ff6b35;">🎓 Nuevo curso disponible</h2>
          <h3>${course.titulo}</h3>
          <p style="font-size: 16px; line-height: 1.5;">${course.descripcion}</p>
          <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p><b>📅 Fecha:</b> ${course.fecha || 'Por confirmar'}</p>
            <p><b>🕐 Hora:</b> ${course.hora || 'Por confirmar'}</p>
            <p><b>👨‍🏫 Profesor:</b> ${
              course.profesor
                ? course.profesor.nombres + ' ' + course.profesor.apellidos
                : 'Por confirmar'
            }</p>
            <p><b>💰 Precio:</b> ${course.precio > 0 ? '$' + course.precio : 'Gratis'}</p>
            <p><b>📍 Modalidad:</b> ${course.tipo.replace('_', ' ')}</p>
          </div>
          <p style="color: #666; font-size: 14px;">¡No te pierdas esta oportunidad de aprender!</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <small style="color: #999;">Sistema de Cursos MAAT</small>
        </div>
      `,
    );
    this.logger.log(`📧 Correo enviado a ${student.correo}`);
  }

  private async sendWhatsAppNotification(student: User, course: Course) {
    const mensaje = `🎓 *NUEVO CURSO DISPONIBLE*

Hola ${student.nombres} 👋

Se ha creado un nuevo curso:
📚 *${course.titulo}*

📖 ${course.descripcion}

📅 *Fecha:* ${course.fecha || 'Por confirmar'}
🕐 *Hora:* ${course.hora || 'Por confirmar'}
👨‍🏫 *Profesor:* ${
      course.profesor ? course.profesor.nombres + ' ' + course.profesor.apellidos : 'Por confirmar'
    }
💰 *Precio:* ${course.precio > 0 ? '$' + course.precio : 'Gratis'}
📍 *Modalidad:* ${course.tipo.replace('_', ' ')}

¡No te lo pierdas! 🚀`;

    await this.enviarWhatsapp(student.celular, mensaje);
  }

  // ===============================
  // Método para enviar WhatsApp
  // ===============================
  private async enviarWhatsapp(celular: string, mensaje: string) {
    if (!celular) {
      this.logger.warn('⚠️ No se pudo enviar WhatsApp: número celular no definido');
      return;
    }

    const token = process.env.WHATSAPP_API_TOKEN;
    if (!token) {
      this.logger.error('❌ No se pudo enviar WhatsApp: token no configurado en .env');
      return;
    }

    const numeroFormateado = celular.replace(/[^0-9]/g, '');
    const url = 'https://app.wbot.ec:443/backend/api/messages/send';
    const data = { number: numeroFormateado, body: mensaje, saveOnTicket: true, linkPreview: true };

    try {
      await axios.post(url, data, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 10000,
      });
      this.logger.log(`📱 Mensaje WhatsApp enviado a ${numeroFormateado}`);
    } catch (error) {
      this.logger.error(
        `❌ Error enviando WhatsApp a ${numeroFormateado}: ${
          JSON.stringify(error.response?.data) || error.message
        }`,
      );
    }
  }

  // ===============================
  // RESTO DE MÉTODOS (sin cambios)
  // ===============================
  findAll() {
    return this.repo.find({ where: { activo: true }, relations: ['profesor'] });
  }
  findById(id: number) {
    return this.repo.findOne({ where: { id }, relations: ['profesor'] });
  }
  async updateCupos(courseId: number, nuevoCupo: number) {
    await this.repo.update(courseId, { cupos: nuevoCupo });
  }
  async update(id: number, data: Partial<Course>) {
    const course = await this.findById(id);
    if (!course) throw new NotFoundException('Curso no encontrado');
    await this.repo.update(id, data);
    return this.findById(id);
  }
  async findUserById(id: number) {
    return this.usersService.findById(id);
  }
  async softDeleteCourse(id: number) {
    const result = await this.repo.update(id, { activo: false });
    if (result.affected === 0) throw new NotFoundException('Curso no encontrado');
    return { success: true };
  }
  async misCursos(userId: number) {
    const inscritos = await this.studentCourseRepo.find({ where: { estudianteId: userId } });
    const cursosIds = inscritos.map((x) => x.cursoId);
    if (!cursosIds.length) return [];
    const cursos = await this.repo.find({
      where: { id: In(cursosIds) },
      relations: ['profesor'],
    });
    return cursos.map((curso) => ({
      ...curso,
      profesorNombre: curso.profesor
        ? `${curso.profesor.nombres} ${curso.profesor.apellidos}`
        : null,
      profesorAsignatura: curso.profesor ? curso.profesor.asignatura : null,
    }));
  }
  async estudiantesCurso(cursoId: number) {
    const inscripciones = await this.studentCourseRepo.find({ where: { cursoId } });
    const estudianteIds = inscripciones.map((x) => x.estudianteId);
    if (!estudianteIds.length) return [];
    return this.usersService.findByIds(estudianteIds);
  }
  async cursosConEstadoInscrito(userId: number) {
    const cursos = await this.repo.find({ where: { activo: true }, relations: ['profesor'] });
    const inscritos = await this.studentCourseRepo.find({ where: { estudianteId: userId } });
    const inscritosIds = inscritos.map((x) => x.cursoId);
    return cursos.map((curso) => ({
      ...curso,
      inscrito: inscritosIds.includes(curso.id),
      profesorNombre: curso.profesor
        ? `${curso.profesor.nombres} ${curso.profesor.apellidos}`
        : null,
      asignatura: curso.profesor ? curso.profesor.asignatura : null,
    }));
  }
  async estudiantesCursoConPagos(cursoId: number) {
    const inscripciones = await this.studentCourseRepo.find({
      where: { cursoId },
      relations: ['estudiante'],
    });

    const pagos = await this.paymentAttemptRepo.find({
      where: { cursoId, status: 'Approved' },
    });

    const estudiantesConPagos = inscripciones.map((inscripcion) => {
      const pago = pagos.find((p) => p.userId === inscripcion.estudianteId);
      return {
        id: inscripcion.estudiante.id,
        nombres: inscripcion.estudiante.nombres,
        apellidos: inscripcion.estudiante.apellidos,
        correo: inscripcion.estudiante.correo,
        montoPagado: pago ? Number(pago.amount) : 0,
        metodoPago: pago ? 'Payphone' : 'Gratis',
        fechaInscripcion: inscripcion.createdAt,
      };
    });

    return { estudiantes: estudiantesConPagos };
  }
}
