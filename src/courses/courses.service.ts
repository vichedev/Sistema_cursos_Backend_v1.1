import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Course } from './course.entity';
import { StudentCourse } from './student-course.entity';
import { PaymentAttempt } from '../payments/payment-attempt.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class CoursesService {
  constructor(
    @InjectRepository(Course) private repo: Repository<Course>,
    @InjectRepository(StudentCourse) private studentCourseRepo: Repository<StudentCourse>,
    @InjectRepository(PaymentAttempt) private paymentAttemptRepo: Repository<PaymentAttempt>,
    private usersService: UsersService,
  ) { }

  create(data: Partial<Course>) {
    const course = this.repo.create(data);
    return this.repo.save(course);
  }

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
    if (!course) {
      throw new NotFoundException('Curso no encontrado');
    }

    // Actualizar el curso
    await this.repo.update(id, data);

    // Devolver el curso actualizado
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
      profesorNombre: curso.profesor ? `${curso.profesor.nombres} ${curso.profesor.apellidos}` : null,
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
      profesorNombre: curso.profesor ? `${curso.profesor.nombres} ${curso.profesor.apellidos}` : null,
      asignatura: curso.profesor ? curso.profesor.asignatura : null,
    }));
  }

  // En tu courses.service.ts
  async estudiantesCursoConPagos(cursoId: number) {
    // Obtener las inscripciones con información de pago
    const inscripciones = await this.studentCourseRepo.find({
      where: { cursoId },
      relations: ['estudiante']
    });

    // Obtener información de pagos desde la tabla de payment_attempts
    const pagos = await this.paymentAttemptRepo.find({
      where: {
        cursoId,
        status: 'Approved' // Solo pagos aprobados
      }
    });

    // Combinar la información
    const estudiantesConPagos = inscripciones.map(inscripcion => {
      const pago = pagos.find(p => p.userId === inscripcion.estudianteId);

      return {
        id: inscripcion.estudiante.id,
        nombres: inscripcion.estudiante.nombres,
        apellidos: inscripcion.estudiante.apellidos,
        correo: inscripcion.estudiante.correo,
        montoPagado: pago ? Number(pago.amount) : 0,
        metodoPago: pago ? 'Payphone' : 'Gratis',
        fechaInscripcion: inscripcion.createdAt
      };
    });

    return { estudiantes: estudiantesConPagos };
  }



}