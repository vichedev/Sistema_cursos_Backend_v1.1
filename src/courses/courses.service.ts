// src/courses/courses.service.ts
import { Injectable, NotFoundException, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan } from 'typeorm';
import { Course } from './course.entity';
import { StudentCourse } from './student-course.entity';
import { PaymentAttempt } from '../payments/payment-attempt.entity';
import { UsersService } from '../users/users.service';
import { MailService } from '../common/mail.service';
import { User } from '../users/user.entity';
import axios from 'axios';

// ✅ importar el SERVICE SSE (no controller)
import { NotificationsSseService } from '../notifications/notifications.sse.service';

// ✅ Importar servicio de cupones
import { CouponsService } from '../coupons/coupons.service';

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
    // ✅ inyecta el servicio de cupones
    private readonly couponsService: CouponsService,
  ) { }

  // ===============================
  // ✅ MÉTODO AUXILIAR: Formatear fecha sin zona horaria
  // ===============================
  private formatDateOnly(fecha: any): string {
    // Si ya es un string en formato correcto, devolverlo
    if (typeof fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return fecha;
    }

    // Si es un objeto Date, extraer solo año-mes-día
    if (fecha instanceof Date) {
      const year = fecha.getFullYear();
      const month = String(fecha.getMonth() + 1).padStart(2, '0');
      const day = String(fecha.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    // Si es un string con hora (ISO), extraer solo la fecha
    if (typeof fecha === 'string' && fecha.includes('T')) {
      return fecha.split('T')[0];
    }

    // Fallback: intentar convertir a Date y formatear
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
    // ✅ Asegurar que la fecha se guarde en formato correcto
    if (data.fecha) {
      data.fecha = this.formatDateOnly(data.fecha);
    }

    // ✅ Extraer cupones del data si existen
    let cuponesData = [];
    if (data.cupones) {
      try {
        cuponesData = typeof data.cupones === 'string'
          ? JSON.parse(data.cupones)
          : data.cupones;
        delete data.cupones; // Remover del data principal
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

    // ✅ CREAR CUPONES ASOCIADOS AL CURSO
    if (cuponesData.length > 0) {
      try {

        for (const cuponItem of cuponesData) {
          try {
            // ✅ VERIFICACIÓN DE TIPO SEGURA
            if (cuponItem &&
              typeof cuponItem === 'object' &&
              'codigo' in cuponItem &&
              'tipo' in cuponItem &&
              'usosMaximos' in cuponItem) {

              const cuponData = cuponItem as {
                codigo: string;
                tipo: string;
                usosMaximos: number;
                fechaExpiracion?: string;
              };

              const cuponCreado = await this.couponsService.createCoupon({
                codigo: cuponData.codigo,
                tipo: cuponData.tipo as any,
                usosMaximos: cuponData.usosMaximos,
                fechaExpiracion: cuponData.fechaExpiracion,
                cursoId: courseId
              });

              // ✅ ACCEDER AL ID DE FORMA SEGURA
              const cuponId = (cuponCreado as any).id || 'N/A';

            } else {
              console.warn('❌ Datos de cupón inválidos:', cuponItem);
            }
          } catch (cuponError) {
            console.error('❌ Error creando cupón individual:', cuponError);
            // Continuar con el siguiente cupón
          }
        }
        this.logger.log(`✅ ${cuponesData.length} cupones procesados para el curso ${courseId}`);
      } catch (error) {
        this.logger.error('Error en proceso de creación de cupones:', error);
      }
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
  // ✅ MÉTODO PARA OBTENER CURSO CON CUPONES
  // ===============================
  async findByIdWithCoupons(id: number) {
    const course = await this.findById(id);
    if (!course) {
      throw new NotFoundException('Curso no encontrado');
    }

    // Obtener cupones del curso
    const cupones = await this.couponsService.getCouponsByCourse(id);

    return {
      ...course,
      cupones
    };
  }

  // ===============================
  // ✅ MÉTODO PARA VALIDAR Y APLICAR CUPÓN
  // ===============================
  async validateAndApplyCoupon(cursoId: number, codigoCupon: string, userId: number) {
    try {
      const result = await this.couponsService.validateAndApplyCoupon(
        cursoId,
        codigoCupon,
        userId
      );

      return result;
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
  // Notificar en segundo plano con lotes + SSE - CORREGIDO
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
              // ✅ CORREGIDO: Manejar cada notificación de forma independiente
              if (correo) {
                try {
                  await this.sendEmailNotification(est, course);
                  this.logger.log(`📧 Correo enviado a ${est.correo}`);
                } catch (emailError) {
                  this.logger.error(`❌ Error enviando correo a ${est.correo}: ${emailError.message}`);
                  // ✅ CONTINUAR con WhatsApp incluso si falla el correo
                }
              }

              // ✅ WhatsApp se ejecuta independientemente del resultado del correo
              if (whatsapp && est.celular) {
                try {
                  await this.sendWhatsAppNotification(est, course);
                  this.logger.log(`📱 WhatsApp enviado a ${est.celular}`);
                } catch (whatsappError) {
                  this.logger.error(`❌ Error enviando WhatsApp a ${est.celular}: ${whatsappError.message}`);
                }
              }

            } catch (err) {
              this.logger.error(`❌ Error general notificando a ${est.correo}: ${err.message}`);
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
  // Métodos auxiliares para notificaciones - MEJORADO
  // ===============================
  private async sendEmailNotification(student: User, course: Course) {
    try {
      const frontendUrl = process.env.FRONTEND_URL || 'https://moviesplus.xyz';

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
          <p><b>👨‍🏫 Profesor:</b> ${course.profesor
          ? course.profesor.nombres + ' ' + course.profesor.apellidos
          : 'Por confirmar'
        }</p>
          <p><b>💰 Precio:</b> ${course.precio > 0 ? '$' + course.precio : 'Gratis'}</p>
          <p><b>📍 Modalidad:</b> ${course.tipo.replace('_', ' ')}</p>
        </div>
        <div style="text-align: center; margin: 25px 0;">
          <a href="${frontendUrl}" 
             style="background: #ff6b35; color: white; padding: 12px 30px; 
                    text-decoration: none; border-radius: 6px; font-weight: bold;
                    display: inline-block; font-size: 16px;">
            🚀 Ingresar al Sistema
          </a>
        </div>
        <p style="text-align: center; color: #666; font-size: 14px;">
          <b>Enlace de acceso:</b> ${frontendUrl}
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <small style="color: #999;">Sistema de Cursos MAAT</small>
      </div>
    `,
      );

      this.logger.log(`✅ Correo enviado exitosamente a ${student.correo}`);
      return true;

    } catch (error) {
      this.logger.error(`❌ Error enviando correo a ${student.correo}: ${error.message}`);
      throw error; // Relanzar el error para que el caller lo maneje
    }
  }

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
        `❌ Error enviando WhatsApp a ${numeroFormateado}: ${JSON.stringify(error.response?.data) || error.message
        }`,
      );
    }
  }

  findAll() {
    return this.repo
      .createQueryBuilder('course')
      .leftJoinAndSelect('course.profesor', 'profesor')
      // ❌ QUITAR: .leftJoinAndSelect('course.cupones', 'cupones')
      .select([
        'course.id',
        'course.titulo',
        'course.descripcion',
        'course.imagen',
        'course.tipo',
        'course.cupos',
        'course.link',
        'course.precio',
        'course.fecha',
        'course.hora',
        'course.activo',
        'course.createdAt',
        'course.updatedAt',
        'profesor.id',
        'profesor.nombres',
        'profesor.apellidos',
        'profesor.asignatura',
        // ❌ QUITAR 'cupones'
      ])
      .where('course.activo = :activo', { activo: true })
      .getMany();
  }

  findById(id: number) {
    return this.repo.findOne({
      where: { id },
      relations: ['profesor'], // ❌ QUITAR 'cupones'
      select: {
        id: true,
        titulo: true,
        descripcion: true,
        imagen: true,
        tipo: true,
        cupos: true,
        link: true,
        precio: true,
        fecha: true,
        hora: true,
        activo: true,
        createdAt: true,
        updatedAt: true,
        profesor: {
          id: true,
          nombres: true,
          apellidos: true,
          asignatura: true
        },
        // ❌ QUITAR toda la sección de cupones
      }
    });
  }

  async updateCupos(courseId: number, nuevoCupo: number) {
    await this.repo.update(courseId, { cupos: nuevoCupo });
  }

  // Update cursos con manejo de cupones
  async update(id: number, data: Partial<Course>) {
    const course = await this.findById(id);
    if (!course) throw new NotFoundException('Curso no encontrado');

    // ✅ Si se actualiza la fecha, formatearla correctamente
    if (data.fecha) {
      data.fecha = this.formatDateOnly(data.fecha);
    }

    // ✅ Extraer cupones del data si existen
    let cuponesData = [];
    if (data.cupones) {
      try {
        cuponesData = typeof data.cupones === 'string'
          ? JSON.parse(data.cupones)
          : data.cupones;
        delete data.cupones; // Remover del data principal
      } catch (error) {
        this.logger.error('Error parseando cupones:', error);
      }
    }

    await this.repo.update(id, data);

    // ✅ ACTUALIZACIÓN INTELIGENTE DE CUPONES
    if (cuponesData.length >= 0) { // Incluye cuando es array vacío (eliminar todos)
      await this.syncCouponsForCourse(id, cuponesData);
    }

    return this.findById(id);
  }

  // 🆕 MÉTODO PARA SINCRONIZACIÓN INTELIGENTE DE CUPONES
  private async syncCouponsForCourse(cursoId: number, nuevosCupones: any[]) {
    try {
      // Obtener cupones actuales del curso
      const cuponesActuales = await this.couponsService.getCouponsByCourse(cursoId);

      // Crear mapas para comparación eficiente
      const mapaActuales = new Map(cuponesActuales.map(c => [c.id, c]));
      const mapaNuevos = new Map(nuevosCupones.filter(c => c.id).map(c => [c.id, c]));
      const nuevosSinId = nuevosCupones.filter(c => !c.id);

      // Identificar cupones a eliminar (están en actuales pero no en nuevos)
      const cuponesAEliminar = cuponesActuales.filter(cupónActual =>
        !mapaNuevos.has(cupónActual.id)
      );

      // Identificar cupones a actualizar (están en ambos)
      const cuponesAActualizar = nuevosCupones.filter(cupónNuevo =>
        cupónNuevo.id && mapaActuales.has(cupónNuevo.id)
      );

      // Procesar eliminaciones
      for (const cupon of cuponesAEliminar) {
        await this.couponsService.deleteCoupon(cupon.id);
        this.logger.log(`🗑️ Cupón eliminado: ${cupon.codigo} (ID: ${cupon.id})`);
      }

      // Procesar actualizaciones
      for (const cuponData of cuponesAActualizar) {
        await this.couponsService.updateCoupon(cuponData.id, {
          codigo: cuponData.codigo,
          tipo: cuponData.tipo,
          usosMaximos: cuponData.usosMaximos,
          fechaExpiracion: cuponData.fechaExpiracion
        });
        this.logger.log(`✏️ Cupón actualizado: ${cuponData.codigo} (ID: ${cuponData.id})`);
      }

      // Procesar nuevas creaciones
      for (const cuponData of nuevosSinId) {
        const cuponCreado = await this.couponsService.createCoupon({
          ...cuponData,
          cursoId: cursoId
        });
        this.logger.log(`🆕 Cupón creado: ${cuponData.codigo} (ID: ${(cuponCreado as any).id})`);
      }

      this.logger.log(`✅ Sincronización completada: ${cuponesAEliminar.length} eliminados, ${cuponesAActualizar.length} actualizados, ${nuevosSinId.length} creados para el curso ${cursoId}`);

    } catch (error) {
      this.logger.error(`❌ Error en sincronización de cupones para curso ${cursoId}:`, error);
      throw error;
    }
  }

  async findUserById(id: number) {
    return this.usersService.findById(id);
  }

  // ===============================
  // ✅ MODIFICAR softDeleteCourse PARA INCLUIR DESACTIVACIÓN DE CUPONES
  // ===============================
  async softDeleteCourse(id: number) {
    const course = await this.findById(id);
    if (!course) throw new NotFoundException('Curso no encontrado');

    // Desactivar cupones antes de archivar el curso
    await this.deactivateCouponsOnCourseArchive(id);

    const result = await this.repo.update(id, { activo: false });
    if (result.affected === 0) throw new NotFoundException('Curso no encontrado');

    this.logger.log(`✅ Curso ${id} archivado y cupones desactivados`);
    return { success: true };
  }
  async misCursos(userId: number) {
    const inscritos = await this.studentCourseRepo.find({
      where: { estudianteId: userId }
    });

    const cursosIds = inscritos.map((x) => x.cursoId);

    if (!cursosIds.length) {
      return [];
    }

    const cursos = await this.repo
      .createQueryBuilder('course')
      .leftJoinAndSelect('course.profesor', 'profesor')
      .select([
        'course.id',
        'course.titulo',
        'course.descripcion',
        'course.imagen',
        'course.tipo',
        'course.cupos',
        'course.link',
        'course.precio',
        'course.fecha',
        'course.hora',
        'course.activo',
        'course.createdAt',
        'course.updatedAt',
        'profesor.id',
        'profesor.nombres',
        'profesor.apellidos',
        'profesor.asignatura'
      ])
      .where('course.id IN (:...cursosIds)', { cursosIds })
      .getMany();

    return cursos.map((curso) => ({
      ...curso,
      profesorNombre: curso.profesor
        ? `${curso.profesor.nombres} ${curso.profesor.apellidos}`
        : null,
      profesorAsignatura: curso.profesor ? curso.profesor.asignatura : null,
    }));
  }

  async estudiantesCurso(cursoId: number) {
    const inscripciones = await this.studentCourseRepo.find({
      where: { cursoId },
      relations: ['estudiante']
    });

    const estudianteIds = inscripciones.map((x) => x.estudianteId);
    if (!estudianteIds.length) return [];

    // ✅ Usar queryBuilder para control exacto de datos
    return this.userRepo
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.nombres',
        'user.apellidos',
        'user.ciudad',
        'user.empresa',
        'user.cargo',
        'user.rol',
        'user.activo'
        // ❌ NO incluir: correo, usuario, cedula, celular, password, etc.
      ])
      .where('user.id IN (:...estudianteIds)', { estudianteIds })
      .andWhere('user.activo = :activo', { activo: true })
      .getMany();
  }

  async cursosConEstadoInscrito(userId: number) {
    // ❌ ELIMINAR la relación con cupones de la consulta principal
    const cursos = await this.repo
      .createQueryBuilder('course')
      .leftJoinAndSelect('course.profesor', 'profesor')
      // ❌ QUITAR: .leftJoinAndSelect('course.cupones', 'cupones')
      .select([
        'course.id',
        'course.titulo',
        'course.descripcion',
        'course.imagen',
        'course.tipo',
        'course.cupos',
        'course.link',
        'course.precio',
        'course.fecha',
        'course.hora',
        'course.activo',
        'course.createdAt',
        'course.updatedAt',
        'profesor.id',
        'profesor.nombres',
        'profesor.apellidos',
        'profesor.asignatura',
        // ❌ QUITAR todos los campos de cupones
      ])
      .where('course.activo = :activo', { activo: true })
      .getMany();

    const inscritos = await this.studentCourseRepo.find({
      where: { estudianteId: userId }
    });

    const pagosAprobados = await this.paymentAttemptRepo.find({
      where: {
        userId: userId,
        status: 'Approved'
      }
    });

    const inscritosIds = inscritos.map((x) => x.cursoId);
    const cursosPagadosIds = pagosAprobados.map((p) => p.cursoId);

    // ✅ CONSULTA SEPARADA PARA CUPONES (no se envía al frontend)
    const cursosConCupones = await this.repo
      .createQueryBuilder('course')
      .leftJoinAndSelect('course.cupones', 'cupones')
      .select([
        'course.id',
        'cupones.id',
        'cupones.tipo',
        'cupones.activo',
        'cupones.usosActuales',
        'cupones.usosMaximos',
        'cupones.fechaExpiracion'
      ])
      .where('course.activo = :activo', { activo: true })
      .getMany();

    return cursos.map((curso) => {
      const estaInscrito = inscritosIds.includes(curso.id);
      const haPagado = cursosPagadosIds.includes(curso.id);

      let linkAMostrar: string | null = null;
      let puedeVerLink = false;

      if (curso.tipo.includes('GRATIS') && estaInscrito) {
        linkAMostrar = curso.link;
        puedeVerLink = true;
      } else if (curso.tipo.includes('PAGADO') && haPagado) {
        linkAMostrar = curso.link;
        puedeVerLink = true;
      }

      // ✅ BUSCAR LOS CUPONES DEL CURSO ACTUAL EN LA CONSULTA SEPARADA
      const cursoConCupones = cursosConCupones.find(c => c.id === curso.id);
      const tieneCupones = cursoConCupones?.cupones?.some(cupon => {
        const activo = cupon.activo !== false;
        const usosDisponibles = cupon.usosActuales < cupon.usosMaximos;
        const noExpirado = !cupon.fechaExpiracion || new Date() < new Date(cupon.fechaExpiracion);
        return activo && usosDisponibles && noExpirado;
      }) || false;

      return {
        ...curso,
        link: linkAMostrar,
        puedeVerLink: puedeVerLink,
        inscrito: estaInscrito,
        haPagado: haPagado,
        profesorNombre: curso.profesor
          ? `${curso.profesor.nombres} ${curso.profesor.apellidos}`
          : null,
        asignatura: curso.profesor ? curso.profesor.asignatura : null,
        tieneCupones: tieneCupones, // ✅ SOLO EL BOOLEANO
        // ❌ NO incluir la propiedad 'cupones'
      };
    });
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

  // En el CoursesService, agrega estos nuevos métodos:

  async findInactiveCourses() {
    try {
      const result = await this.repo
        .createQueryBuilder('course')
        .leftJoinAndSelect('course.profesor', 'profesor')
        .select([
          'course.id',
          'course.titulo',
          'course.descripcion',
          'course.imagen',
          'course.tipo',
          'course.cupos',
          'course.link',
          'course.precio',
          'course.fecha',
          'course.hora',
          'course.activo',
          'course.createdAt',
          'course.updatedAt',
          'profesor.id',
          'profesor.nombres',
          'profesor.apellidos',
          'profesor.asignatura',
        ])
        .where('course.activo = :activo', { activo: false })
        .orderBy('course.updatedAt', 'DESC')
        .getMany();

      return result;
    } catch (error) {
      console.error('❌ [SERVICE] Error en findInactiveCourses:', error);
      throw error;
    }
  }

  // ===============================
  // ✅ OBTENER TODOS LOS CURSOS (ACTIVOS E INACTIVOS) PARA ADMIN
  // ===============================
  async findAllForAdmin() {
    return this.repo
      .createQueryBuilder('course')
      .leftJoinAndSelect('course.profesor', 'profesor')
      .select([
        'course.id',
        'course.titulo',
        'course.descripcion',
        'course.imagen',
        'course.tipo',
        'course.cupos',
        'course.link',
        'course.precio',
        'course.fecha',
        'course.hora',
        'course.activo',
        'course.createdAt',
        'course.updatedAt',
        'profesor.id',
        'profesor.nombres',
        'profesor.apellidos',
        'profesor.asignatura',
      ])
      .orderBy('course.activo', 'DESC') // Primero los activos, luego los inactivos
      .addOrderBy('course.updatedAt', 'DESC')
      .getMany();
  }

  // ===============================
  // ✅ MODIFICAR activateCourse PARA INCLUIR ACTIVACIÓN DE CUPONES
  // ===============================
  async activateCourse(id: number) {
    const course = await this.findById(id);
    if (!course) throw new NotFoundException('Curso no encontrado');

    const result = await this.repo.update(id, { activo: true });
    if (result.affected === 0) throw new NotFoundException('Curso no encontrado');

    // Activar cupones al restaurar el curso
    await this.activateCouponsOnCourseRestore(id);

    this.logger.log(`✅ Curso ${id} activado y cupones reactivados`);
    return { success: true, message: 'Curso activado correctamente' };
  }


  // ===============================
  // ✅ DESACTIVAR CUPONES AL ARCHIVAR CURSO
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
  // ✅ ACTIVAR CUPONES AL DESARCHIVAR CURSO
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

  // En courses.service.ts - agregar este método
  async deleteCoursePermanently(id: number): Promise<{ success: boolean; message: string }> {
    try {
      const course = await this.findById(id);
      if (!course) {
        throw new NotFoundException('Curso no encontrado');
      }

      // ✅ ELIMINAR TODOS LOS CUPONES ASOCIADOS AL CURSO PRIMERO
      await this.couponsService.deleteAllCouponsByCourse(id);

      // ✅ ELIMINAR INSCRIPCIONES DE ESTUDIANTES
      await this.studentCourseRepo.delete({ cursoId: id });

      // ✅ ELIMINAR INTENTOS DE PAGO ASOCIADOS
      await this.paymentAttemptRepo.delete({ cursoId: id });

      // ✅ FINALMENTE ELIMINAR EL CURSO
      await this.repo.delete(id);

      this.logger.log(`✅ Curso ${id} eliminado permanentemente con todos sus datos asociados`);
      return {
        success: true,
        message: 'Curso eliminado definitivamente junto con todos sus cupones, inscripciones y datos asociados'
      };

    } catch (error) {
      // Manejar error de violación de clave foránea
      if (error.code === '23503') {
        return {
          success: false,
          message: 'No se puede eliminar el curso porque tiene información asociada que no se pudo eliminar automáticamente'
        };
      }

      this.logger.error(`❌ Error eliminando curso ${id} permanentemente:`, error);
      return {
        success: false,
        message: 'Error interno del servidor al eliminar el curso'
      };
    }
  }

}