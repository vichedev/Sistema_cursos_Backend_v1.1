import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Course } from '../courses/course.entity';
import { User } from '../users/user.entity';
import { StudentCourse } from '../courses/student-course.entity';

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(Course) private courseRepo: Repository<Course>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(StudentCourse) private studentCourseRepo: Repository<StudentCourse>,
  ) {}

  async getGeneralStats() {
    const totalCursos = await this.courseRepo.count({ where: { activo: true } });
    const totalEstudiantes = await this.userRepo.count({ where: { rol: 'ESTUDIANTE' } });
    const totalProfesores = await this.userRepo.count({ where: { rol: 'ADMIN' } }); // o donde almacenas profesores
    const totalInscripciones = await this.studentCourseRepo.count();

    return {
      totalCursos,
      totalEstudiantes,
      totalProfesores,
      totalInscripciones,
    };
  }
}
