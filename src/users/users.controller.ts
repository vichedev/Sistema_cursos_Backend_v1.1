import {
  Controller,
  Get,
  UseGuards,
  Param,
  Put,
  Body,
  Post,
  Delete,
  NotFoundException
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) { }

  @Get('profesores')
  async getProfesores() {
    return this.usersService.findProfesores();
  }

  @Get('usuarios-por-rol')
  async getUsuariosPorRol() {
    // Obtener estudiantes con sus cursos y campos adicionales
    const estudiantes = await this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.studentCourses', 'studentCourse')
      .leftJoinAndSelect('studentCourse.curso', 'curso')
      .addSelect(['user.ciudad', 'user.empresa', 'user.cargo', 'user.password', 'user.usuario', 'user.rol'])
      .where('user.rol = :rol', { rol: 'ESTUDIANTE' })
      .getMany();

    const estudiantesFormateados = estudiantes.map(u => ({
      id: u.id,
      nombres: u.nombres,
      apellidos: u.apellidos,
      correo: u.correo,
      usuario: u.usuario,
      rol: u.rol,
      ciudad: u.ciudad,
      empresa: u.empresa,
      cargo: u.cargo,
      password: u.password,
      cursos: (u.studentCourses || [])
        .filter(sc => !!sc.curso)
        .map(sc => ({
          id: sc.curso.id,
          titulo: sc.curso.titulo,
        })),
    }));

    // Obtener administradores con todos los campos requeridos
    const administradores = await this.userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.nombres',
        'user.apellidos',
        'user.correo',
        'user.usuario',
        'user.rol',
        'user.ciudad',
        'user.empresa',
        'user.cargo',
        'user.password',
        'user.asignatura', // nuevo campo
      ])
      .where('user.rol = :rol', { rol: 'ADMIN' })
      .getMany();

    const administradoresFormateados = administradores.map(u => ({
      id: u.id,
      nombres: u.nombres,
      apellidos: u.apellidos,
      correo: u.correo,
      usuario: u.usuario,
      rol: u.rol,
      ciudad: u.ciudad,
      empresa: u.empresa,
      cargo: u.cargo,
      password: u.password,
      asignatura: u.asignatura,  // enviar asignatura al frontend
    }));


    return {
      estudiantes: estudiantesFormateados,
      administradores: administradoresFormateados,
    };
  }
  // crear un admin
  @Post()
  async createUser(@Body() userData: Partial<User>) {
    return this.usersService.create(userData);
  }

  @Get(':id')
  async getUserById(@Param('id') id: number) {
    const user = await this.usersService.findById(id);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return user;
  }

  @Put(':id')
  async updateUser(@Param('id') id: number, @Body() updateData: Partial<User>) {
    return this.usersService.update(id, updateData);
  }

  @Delete(':id')
  async deleteUser(@Param('id') id: number) {
    return this.usersService.delete(id);
  }
}
