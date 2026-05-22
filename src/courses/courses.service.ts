// src/courses/courses.service.ts
import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from './course.entity';
import { StudentCourse } from './student-course.entity';
import { PaymentAttempt } from '../payments/payment-attempt.entity';
import { UsersService } from '../users/users.service';
import { MailService } from '../common/mail.service';
import { User } from '../users/user.entity';

import { NotificationsSseService } from '../notifications/notifications.sse.service';
import { CouponsService } from '../coupons/coupons.service';
import { isDateOnlyExpired } from '../common/date.util';
import { WhatsappService } from '../whatsapp/whatsapp.service';

@Injectable()
export class CoursesService {
  private readonly logger = new Logger(CoursesService.name);

  constructor(
    @InjectRepository(Course) private repo: Repository<Course>,
    @InjectRepository(StudentCourse)
    private studentCourseRepo: Repository<StudentCourse>,
    @InjectRepository(PaymentAttempt)
    private paymentAttemptRepo: Repository<PaymentAttempt>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private usersService: UsersService,
    private mail: MailService,
    private readonly sse: NotificationsSseService,
    private readonly couponsService: CouponsService,
    private readonly whatsapp: WhatsappService,
  ) { }

  // ===============================
  // ✅ MÉTODO AUXILIAR: Formatear fecha sin zona horaria
  // ===============================
  private formatDateOnly(fecha: any): string {
    if (typeof fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return fecha;
    }
    if (fecha instanceof Date) {
      const year = fecha.getFullYear();
      const month = String(fecha.getMonth() + 1).padStart(2, '0');
      const day = String(fecha.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    if (typeof fecha === 'string' && fecha.includes('T')) {
      return fecha.split('T')[0];
    }
    try {
      const d = new Date(fecha);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch {
      return fecha;
    }
  }

  // ===============================
  // ✅ CREAR CURSO + Notificación en segundo plano + CUPONES
  // ===============================
  async create(data: any) {
    if (data.fecha) {
      data.fecha = this.formatDateOnly(data.fecha);
    }

    let cuponesData = [];
    if (data.cupones) {
      try {
        cuponesData =
          typeof data.cupones === 'string'
            ? JSON.parse(data.cupones)
            : data.cupones;
        delete data.cupones;
      } catch (error) {
        this.logger.error('Error parseando cupones:', error);
      }
    }

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

    if (cuponesData.length > 0) {
      try {
        for (const cuponItem of cuponesData) {
          try {
            if (
              cuponItem &&
              typeof cuponItem === 'object' &&
              'codigo' in cuponItem &&
              'tipo' in cuponItem &&
              'usosMaximos' in cuponItem
            ) {
              const cuponData = cuponItem as {
                codigo: string;
                tipo: string;
                usosMaximos: number;
                fechaExpiracion?: string;
              };
              await this.couponsService.createCoupon({
                codigo: cuponData.codigo,
                tipo: cuponData.tipo as any,
                usosMaximos: cuponData.usosMaximos,
                fechaExpiracion: cuponData.fechaExpiracion,
                cursoId: courseId,
              });
            } else {
              console.warn('❌ Datos de cupón inválidos:', cuponItem);
            }
          } catch (cuponError) {
            console.error('❌ Error creando cupón individual:', cuponError);
          }
        }
        this.logger.log(`✅ ${cuponesData.length} cupones procesados para el curso ${courseId}`);
      } catch (error) {
        this.logger.error('Error en proceso de creación de cupones:', error);
      }
    }

    const notificarCorreo =
      data.notificarCorreo === 'true' || data.notificarCorreo === true;
    const notificarWhatsapp =
      data.notificarWhatsapp === 'true' || data.notificarWhatsapp === true;

    if (notificarCorreo || notificarWhatsapp) {
      this.notifyAllStudentsBackground(courseId, notificarCorreo, notificarWhatsapp).catch(
        (err) => this.logger.error(`Error en notificación en segundo plano: ${err.message}`),
      );
    }

    const createdCourse = await this.findById(courseId);

    // Notificar a estudiantes conectados sobre el nuevo curso via SSE
    this.sse.emitNewCourse(
      courseId,
      data.titulo,
      data.tipo,
      parseFloat(String(data.precio || 0)),
      data.imagen || null,
    );

    return createdCourse;
  }

  // ===============================
  // ✅ MÉTODO PARA OBTENER CURSO CON CUPONES
  // ===============================
  async findByIdWithCoupons(id: number) {
    const course = await this.findById(id);
    if (!course) throw new NotFoundException('Curso no encontrado');
    const cupones = await this.couponsService.getCouponsByCourse(id);
    return { ...course, cupones };
  }

  // ===============================
  // ✅ MÉTODO PARA VALIDAR Y APLICAR CUPÓN
  // ===============================
  async validateAndApplyCoupon(cursoId: number, codigoCupon: string, userId: number) {
    try {
      return await this.couponsService.validateAndApplyCoupon(cursoId, codigoCupon, userId);
    } catch (error) {
      this.logger.error(`Error aplicando cupón: ${error.message}`);
      throw error;
    }
  }

  // ===============================
  // ✅ MÉTODO PARA OBTENER ESTADÍSTICAS DE CUPONES DEL CURSO
  // ===============================
  async getCouponStats(cursoId: number) {
    return this.couponsService.getCouponStatsByCourse(cursoId);
  }

  // ===============================
  // ✅ NOTIFICAR EN SEGUNDO PLANO — lotes paralelos
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

      this.sse.emitStart(courseId, course.titulo, total);
      this.logger.log(`📢 Programando notificaciones para ${total} estudiantes`);

      if (total === 0) {
        this.sse.emitDone(courseId);
        this.logger.log(`✅ Notificaciones (0) completadas para el curso: ${course.titulo}`);
        return;
      }

      let completed = 0;
      const batchSize = 10;
      const delayBetweenBatches = 2 * 60 * 1000; // 2 minutos entre lotes
      const totalBatches = Math.ceil(total / batchSize);

      for (let i = 0; i < total; i += batchSize) {
        const batch = estudiantes.slice(i, i + batchSize);
        const batchIndex = i / batchSize;

        setTimeout(async () => {
          this.logger.log(`⏰ Procesando lote ${batchIndex + 1} de ${totalBatches}`);

          // ✅ CORREOS en paralelo — todos los del lote a la vez
          if (correo) {
            const resultadosCorreo = await Promise.allSettled(
              batch.map((est) => this.sendEmailNotification(est, course)),
            );
            resultadosCorreo.forEach((result, idx) => {
              if (result.status === 'fulfilled') {
                this.logger.log(`📧 Correo enviado a ${batch[idx].correo}`);
              } else {
                this.logger.error(`❌ Error correo a ${batch[idx].correo}: ${result.reason?.message}`);
              }
            });
          }

          // ✅ WHATSAPP en paralelo — solo los que tienen celular
          if (whatsapp) {
            const conCelular = batch.filter((est) => est.celular);
            const resultadosWA = await Promise.allSettled(
              conCelular.map((est) => this.sendWhatsAppNotification(est, course)),
            );
            resultadosWA.forEach((result, idx) => {
              if (result.status === 'fulfilled') {
                this.logger.log(`📱 WhatsApp enviado a ${conCelular[idx].celular}`);
              } else {
                this.logger.error(`❌ Error WhatsApp a ${conCelular[idx].celular}: ${result.reason?.message}`);
              }
            });
          }

          // ✅ PROGRESO: actualizar después de procesar todo el lote
          completed = Math.min(completed + batch.length, total);
          this.sse.emitProgress(courseId, completed, total);

          if (completed >= total) {
            this.sse.emitDone(courseId);
            this.logger.log(`✅ Notificaciones completadas para el curso: ${course.titulo}`);
          }
        }, batchIndex * delayBetweenBatches);
      }
    } catch (err) {
      this.logger.error(`Error en notificación en segundo plano: ${err.message}`);
    }
  }

  // ===============================
  // ✅ ENVIAR CORREO DE NOTIFICACIÓN
  // ===============================
  private async sendEmailNotification(student: User, course: Course) {
    const frontendUrl = process.env.FRONTEND_URL || 'https://moviesplus.xyz';

    await this.mail.sendMail(
      student.correo,
      `📚 Nuevo curso disponible: ${course.titulo}`,
      `
<div style="font-family:Arial,sans-serif;color:#222;max-width:600px;margin:0 auto;">
  <h2 style="color:#ff6b35;">🎓 Nuevo curso disponible</h2>
  <h3>${course.titulo}</h3>
  <p style="font-size:16px;line-height:1.5;">${course.descripcion}</p>
  <div style="background:#f8f9fa;padding:15px;border-radius:8px;margin:20px 0;">
    <p><b>📅 Fecha:</b> ${course.fecha || 'Por confirmar'}</p>
    <p><b>🕐 Hora:</b> ${course.hora || 'Por confirmar'}</p>
    <p><b>👨‍🏫 Profesor:</b> ${course.profesor ? course.profesor.nombres + ' ' + course.profesor.apellidos : 'Por confirmar'}</p>
    <p><b>💰 Precio:</b> ${course.precio > 0 ? '$' + course.precio : 'Gratis'}</p>
    <p><b>📍 Modalidad:</b> ${course.tipo.replace('_', ' ')}</p>
  </div>
  <div style="text-align:center;margin:25px 0;">
    <a href="${frontendUrl}" style="background:#ff6b35;color:white;padding:12px 30px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;font-size:16px;">
      🚀 Ver Curso
    </a>
  </div>
  <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
  <small style="color:#999;">Sistema de Cursos MAAT</small>
</div>
      `,
    );
  }

  // ===============================
  // ✅ ENVIAR NOTIFICACIÓN WHATSAPP
  // ===============================
  private async sendWhatsAppNotification(student: User, course: Course) {
    const frontendUrl = process.env.FRONTEND_URL || 'https://moviesplus.xyz';

    const mensaje = `🎓 *NUEVO CURSO DISPONIBLE*

Hola ${student.nombres} 👋

Se ha creado un nuevo curso:
📚 *${course.titulo}*

📖 ${course.descripcion}

📅 *Fecha:* ${course.fecha || 'Por confirmar'}
🕐 *Hora:* ${course.hora || 'Por confirmar'}
👨‍🏫 *Profesor:* ${course.profesor ? course.profesor.nombres + ' ' + course.profesor.apellidos : 'Por confirmar'}
💰 *Precio:* ${course.precio > 0 ? '$' + course.precio : 'Gratis'}
📍 *Modalidad:* ${course.tipo.replace('_', ' ')}

🌐 *Accede al sistema aquí:*
${frontendUrl}

¡No te lo pierdas! 🚀`;

    await this.enviarWhatsapp(student.celular, mensaje);
  }

  // ===============================
  // ✅ ENVIAR WHATSAPP — vía conexión Baileys (la del QR en Configuración)
  // ===============================
  private async enviarWhatsapp(celular: string, mensaje: string) {
    if (!celular) {
      this.logger.warn('⚠️ No se pudo enviar WhatsApp: número celular no definido');
      return;
    }

    if (!this.whatsapp.getStatus().connected) {
      this.logger.warn('⚠️ WhatsApp no está conectado (escanea el QR en Configuración). Mensaje omitido.');
      return;
    }

    try {
      await this.whatsapp.sendText(celular, mensaje);
      this.logger.log(`📱 Mensaje WhatsApp enviado a ${celular}`);
    } catch (error) {
      this.logger.error(`❌ Error enviando WhatsApp a ${celular}: ${error.message}`);
    }
  }

  // ===============================
  // ✅ FIND ALL (público, activos)
  // ===============================
  findAll() {
    return this.repo
      .createQueryBuilder('course')
      .leftJoinAndSelect('course.profesor', 'profesor')
      .select([
        'course.id', 'course.titulo', 'course.descripcion', 'course.imagen',
        'course.tipo', 'course.cupos', 'course.link', 'course.recursosLink',
        'course.precio', 'course.fecha', 'course.hora', 'course.activo',
        'course.createdAt', 'course.updatedAt',
        'profesor.id', 'profesor.nombres', 'profesor.apellidos', 'profesor.asignatura',
      ])
      .where('course.activo = :activo', { activo: true })
      .getMany();
  }

  // ===============================
  // ✅ FIND BY ID
  // ===============================
  findById(id: number) {
    return this.repo.findOne({
      where: { id },
      relations: ['profesor'],
      select: {
        id: true, titulo: true, descripcion: true, imagen: true,
        tipo: true, cupos: true, link: true, recursosLink: true,
        precio: true, fecha: true, hora: true, activo: true,
        createdAt: true, updatedAt: true,
        profesor: { id: true, nombres: true, apellidos: true, asignatura: true },
      },
      cache: false,
    });
  }

  async updateCupos(courseId: number, nuevoCupo: number) {
    await this.repo.update(courseId, { cupos: nuevoCupo });
  }

  // ===============================
  // ✅ UPDATE CURSO
  // ===============================
  async update(id: number, data: Partial<Course>) {
    const course = await this.findById(id);
    if (!course) throw new NotFoundException('Curso no encontrado');

    if (data.fecha) {
      data.fecha = this.formatDateOnly(data.fecha);
    }

    if (data.tipo && data.tipo.endsWith('GRATIS')) {
      data.precio = 0;
      this.logger.log(`💰 Curso cambiado a GRATIS, forzando precio a 0`);
    }

    let cuponesData = [];
    if (data.cupones) {
      try {
        cuponesData =
          typeof data.cupones === 'string' ? JSON.parse(data.cupones) : data.cupones;
        delete data.cupones;
      } catch (error) {
        this.logger.error('Error parseando cupones:', error);
      }
    }

    await this.repo.update(id, data);

    if (cuponesData.length >= 0) {
      await this.syncCouponsForCourse(id, cuponesData);
    }

    return this.findById(id);
  }

  // ===============================
  // ✅ SINCRONIZACIÓN INTELIGENTE DE CUPONES
  // ===============================
  private async syncCouponsForCourse(cursoId: number, nuevosCupones: any[]) {
    try {
      const cuponesActuales = await this.couponsService.getCouponsByCourse(cursoId);
      const mapaActuales = new Map(cuponesActuales.map((c) => [c.id, c]));
      const mapaNuevos = new Map(nuevosCupones.filter((c) => c.id).map((c) => [c.id, c]));
      const nuevosSinId = nuevosCupones.filter((c) => !c.id);

      const cuponesAEliminar = cuponesActuales.filter((c) => !mapaNuevos.has(c.id));
      const cuponesAActualizar = nuevosCupones.filter((c) => c.id && mapaActuales.has(c.id));

      for (const cupon of cuponesAEliminar) {
        await this.couponsService.deleteCoupon(cupon.id);
        this.logger.log(`🗑️ Cupón eliminado: ${cupon.codigo} (ID: ${cupon.id})`);
      }

      for (const cuponData of cuponesAActualizar) {
        await this.couponsService.updateCoupon(cuponData.id, {
          codigo: cuponData.codigo,
          tipo: cuponData.tipo,
          usosMaximos: cuponData.usosMaximos,
          fechaExpiracion: cuponData.fechaExpiracion,
        });
        this.logger.log(`✏️ Cupón actualizado: ${cuponData.codigo} (ID: ${cuponData.id})`);
      }

      for (const cuponData of nuevosSinId) {
        const creado = await this.couponsService.createCoupon({ ...cuponData, cursoId });
        this.logger.log(`🆕 Cupón creado: ${cuponData.codigo} (ID: ${(creado as any).id})`);
      }

      this.logger.log(
        `✅ Sync cupones curso ${cursoId}: ${cuponesAEliminar.length} eliminados, ${cuponesAActualizar.length} actualizados, ${nuevosSinId.length} creados`,
      );
    } catch (error) {
      this.logger.error(`❌ Error sync cupones curso ${cursoId}:`, error);
      throw error;
    }
  }

  async findUserById(id: number) {
    return this.usersService.findById(id);
  }

  // ===============================
  // ✅ SOFT DELETE CURSO
  // ===============================
  async softDeleteCourse(id: number) {
    const course = await this.findById(id);
    if (!course) throw new NotFoundException('Curso no encontrado');

    await this.deactivateCouponsOnCourseArchive(id);

    const result = await this.repo.update(id, { activo: false });
    if (result.affected === 0) throw new NotFoundException('Curso no encontrado');

    this.logger.log(`✅ Curso ${id} archivado y cupones desactivados`);
    return { success: true };
  }

  // ===============================
  // ✅ MIS CURSOS (estudiante)
  // ===============================
  async misCursos(userId: number) {
    const inscritos = await this.studentCourseRepo.find({ where: { estudianteId: userId } });
    const cursosIds = inscritos.map((x) => x.cursoId);

    if (!cursosIds.length) return [];

    const cursos = await this.repo
      .createQueryBuilder('course')
      .leftJoinAndSelect('course.profesor', 'profesor')
      .select([
        'course.id', 'course.titulo', 'course.descripcion', 'course.imagen',
        'course.tipo', 'course.cupos', 'course.link', 'course.recursosLink',
        'course.precio', 'course.fecha', 'course.hora', 'course.activo',
        'course.createdAt', 'course.updatedAt',
        'profesor.id', 'profesor.nombres', 'profesor.apellidos', 'profesor.asignatura',
      ])
      .where('course.id IN (:...cursosIds)', { cursosIds })
      .getMany();

    // Mapear inscripción por cursoId para incluir datos del diploma
    const inscripcionMap = new Map(inscritos.map((i) => [i.cursoId, i]));

    return cursos.map((curso) => {
      const inscripcion = inscripcionMap.get(curso.id);
      return {
        ...curso,
        profesorNombre: curso.profesor
          ? `${curso.profesor.nombres} ${curso.profesor.apellidos}`
          : null,
        profesorAsignatura: curso.profesor ? curso.profesor.asignatura : null,
        diplomaCodigo: inscripcion?.diplomaCodigo ?? null,
        diplomaEmitidoEn: inscripcion?.diplomaEmitidoEn ?? null,
      };
    });
  }

  // ===============================
  // ✅ ESTUDIANTES DE UN CURSO
  // ===============================
  async estudiantesCurso(cursoId: number) {
    const inscripciones = await this.studentCourseRepo.find({
      where: { cursoId },
      relations: ['estudiante'],
    });

    const estudianteIds = inscripciones.map((x) => x.estudianteId);
    if (!estudianteIds.length) return [];

    return this.userRepo
      .createQueryBuilder('user')
      .select([
        'user.id', 'user.nombres', 'user.apellidos', 'user.ciudad',
        'user.empresa', 'user.cargo', 'user.rol', 'user.activo',
      ])
      .where('user.id IN (:...estudianteIds)', { estudianteIds })
      .andWhere('user.activo = :activo', { activo: true })
      .getMany();
  }

  // ===============================
  // ✅ CURSOS CON ESTADO INSCRITO (dashboard estudiante)
  // ===============================
  async cursosConEstadoInscrito(userId: number) {
    const cursos = await this.repo
      .createQueryBuilder('course')
      .leftJoinAndSelect('course.profesor', 'profesor')
      .select([
        'course.id', 'course.titulo', 'course.descripcion', 'course.imagen',
        'course.tipo', 'course.cupos', 'course.link', 'course.recursosLink',
        'course.precio', 'course.fecha', 'course.hora', 'course.activo',
        'course.createdAt', 'course.updatedAt',
        'profesor.id', 'profesor.nombres', 'profesor.apellidos', 'profesor.asignatura',
      ])
      .where('course.activo = :activo', { activo: true })
      .getMany();

    const inscritos = await this.studentCourseRepo.find({ where: { estudianteId: userId } });
    const pagosAprobados = await this.paymentAttemptRepo.find({
      where: { userId, status: 'Approved' },
    });

    const inscritosIds = inscritos.map((x) => x.cursoId);
    const cursosPagadosIds = pagosAprobados.map((p) => p.cursoId);

    // Consulta separada para cupones (no se expone al frontend)
    const cursosConCupones = await this.repo
      .createQueryBuilder('course')
      .leftJoinAndSelect('course.cupones', 'cupones')
      .select([
        'course.id', 'cupones.id', 'cupones.tipo', 'cupones.activo',
        'cupones.usosActuales', 'cupones.usosMaximos', 'cupones.fechaExpiracion',
      ])
      .where('course.activo = :activo', { activo: true })
      .getMany();

    return cursos.map((curso) => {
      const estaInscrito = inscritosIds.includes(curso.id);
      const haPagado = cursosPagadosIds.includes(curso.id);

      // ✅ link y recursosLink solo visibles si está inscrito
      let linkAMostrar: string | null = null;
      let recursosLinkAMostrar: string | null = null;
      let puedeVerLink = false;
      const puedeVerRecursos = estaInscrito;

      if (estaInscrito) {
        linkAMostrar = curso.link;
        recursosLinkAMostrar = curso.recursosLink;
        puedeVerLink = true;
      }

      const cursoConCupones = cursosConCupones.find((c) => c.id === curso.id);
      const tieneCupones =
        cursoConCupones?.cupones?.some((cupon) => {
          const activo = cupon.activo !== false;
          const usosDisponibles = cupon.usosActuales < cupon.usosMaximos;
          const noExpirado = !isDateOnlyExpired(cupon.fechaExpiracion);
          return activo && usosDisponibles && noExpirado;
        }) || false;

      return {
        ...curso,
        link: linkAMostrar,
        recursosLink: recursosLinkAMostrar,
        puedeVerLink,
        puedeVerRecursos,
        inscrito: estaInscrito,
        haPagado,
        profesorNombre: curso.profesor
          ? `${curso.profesor.nombres} ${curso.profesor.apellidos}`
          : null,
        asignatura: curso.profesor ? curso.profesor.asignatura : null,
        tieneCupones,
      };
    });
  }

  // ===============================
  // ✅ ESTUDIANTES CON PAGOS
  // ===============================
  async estudiantesCursoConPagos(cursoId: number) {
    const inscripciones = await this.studentCourseRepo.find({
      where: { cursoId },
      relations: ['estudiante'],
    });

    const pagos = await this.paymentAttemptRepo.find({
      where: { cursoId, status: 'Approved' },
    });

    return {
      estudiantes: inscripciones.map((inscripcion) => {
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
      }),
    };
  }

  // ===============================
  // ✅ FIND INACTIVE COURSES
  // ===============================
  // MEJ-03: Paginación en cursos inactivos
  async findInactiveCourses(page = 1, limit = 20, search = '') {
    try {
      const qb = this.repo
        .createQueryBuilder('course')
        .leftJoinAndSelect('course.profesor', 'profesor')
        .select([
          'course.id', 'course.titulo', 'course.descripcion', 'course.imagen',
          'course.tipo', 'course.cupos', 'course.link', 'course.recursosLink',
          'course.precio', 'course.fecha', 'course.hora', 'course.activo',
          'course.createdAt', 'course.updatedAt',
          'profesor.id', 'profesor.nombres', 'profesor.apellidos', 'profesor.asignatura',
        ])
        .where('course.activo = :activo', { activo: false })
        .orderBy('course.updatedAt', 'DESC');

      if (search) {
        qb.andWhere('LOWER(course.titulo) LIKE :search', { search: `%${search.toLowerCase()}%` });
      }

      const total = await qb.getCount();
      const data = await qb.skip((page - 1) * limit).take(limit).getMany();
      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    } catch (error) {
      console.error('❌ [SERVICE] Error en findInactiveCourses:', error);
      throw error;
    }
  }

  // MEJ-03: Paginación en cursos admin (todos)
  async findAllForAdmin(page = 1, limit = 20, search = '') {
    const qb = this.repo
      .createQueryBuilder('course')
      .leftJoinAndSelect('course.profesor', 'profesor')
      .select([
        'course.id', 'course.titulo', 'course.descripcion', 'course.imagen',
        'course.tipo', 'course.cupos', 'course.link', 'course.recursosLink',
        'course.precio', 'course.fecha', 'course.hora', 'course.activo',
        'course.createdAt', 'course.updatedAt',
        'profesor.id', 'profesor.nombres', 'profesor.apellidos', 'profesor.asignatura',
      ])
      .orderBy('course.activo', 'DESC')
      .addOrderBy('course.updatedAt', 'DESC');

    if (search) {
      qb.where('LOWER(course.titulo) LIKE :search', { search: `%${search.toLowerCase()}%` });
    }

    const total = await qb.getCount();
    const data = await qb.skip((page - 1) * limit).take(limit).getMany();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ===============================
  // ✅ ACTIVATE COURSE
  // ===============================
  async activateCourse(id: number) {
    const course = await this.findById(id);
    if (!course) throw new NotFoundException('Curso no encontrado');

    const result = await this.repo.update(id, { activo: true });
    if (result.affected === 0) throw new NotFoundException('Curso no encontrado');

    await this.activateCouponsOnCourseRestore(id);

    this.logger.log(`✅ Curso ${id} activado y cupones reactivados`);
    return { success: true, message: 'Curso activado correctamente' };
  }

  // ===============================
  // ✅ DESACTIVAR CUPONES AL ARCHIVAR
  // ===============================
  async deactivateCouponsOnCourseArchive(cursoId: number) {
    try {
      const result = await this.couponsService.deactivateAllCouponsByCourse(cursoId);
      this.logger.log(`✅ Cupones desactivados para curso ${cursoId}: ${result.affected} cupones`);
      return result;
    } catch (error) {
      this.logger.error(`❌ Error desactivando cupones del curso ${cursoId}:`, error);
      throw error;
    }
  }

  // ===============================
  // ✅ ACTIVAR CUPONES AL RESTAURAR
  // ===============================
  async activateCouponsOnCourseRestore(cursoId: number) {
    try {
      const result = await this.couponsService.activateAllCouponsByCourse(cursoId);
      this.logger.log(`✅ Cupones activados para curso ${cursoId}: ${result.affected} cupones`);
      return result;
    } catch (error) {
      this.logger.error(`❌ Error activando cupones del curso ${cursoId}:`, error);
      throw error;
    }
  }

  // ===============================
  // ✅ DELETE PERMANENTE
  // ===============================
  async deleteCoursePermanently(id: number): Promise<{ success: boolean; message: string }> {
    try {
      const course = await this.findById(id);
      if (!course) throw new NotFoundException('Curso no encontrado');

      await this.couponsService.deleteAllCouponsByCourse(id);
      await this.studentCourseRepo.delete({ cursoId: id });
      await this.paymentAttemptRepo.delete({ cursoId: id });
      await this.repo.delete(id);

      this.logger.log(`✅ Curso ${id} eliminado permanentemente`);
      return {
        success: true,
        message: 'Curso eliminado definitivamente junto con todos sus cupones, inscripciones y datos asociados',
      };
    } catch (error) {
      if (error.code === '23503') {
        return {
          success: false,
          message: 'No se puede eliminar el curso porque tiene información asociada que no se pudo eliminar automáticamente',
        };
      }
      this.logger.error(`❌ Error eliminando curso ${id} permanentemente:`, error);
      return { success: false, message: 'Error interno del servidor al eliminar el curso' };
    }
  }
}