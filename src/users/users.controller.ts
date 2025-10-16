import {
  Controller,
  Get,
  UseGuards,
  Param,
  Put,
  Body,
  Post,
  Delete,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
  UseInterceptors,
  Request // ✅ AGREGAR ESTE IMPORT
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';

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
    try {
      // ✅ VERIFICAR SI HAY USUARIOS EN LA BASE DE DATOS
      const totalUsuarios = await this.userRepository.count();

      const todosLosUsuarios = await this.userRepository.find();

      // OBTENER ESTUDIANTES
      const estudiantesQuery = await this.userRepository
        .createQueryBuilder('user')
        .leftJoinAndSelect('user.studentCourses', 'studentCourse')
        .leftJoinAndSelect('studentCourse.curso', 'curso')
        .where('user.rol = :rol', { rol: 'ESTUDIANTE' })
        .getMany();

      const estudiantes = estudiantesQuery.map(user => ({
        id: user.id,
        nombres: user.nombres,
        apellidos: user.apellidos,
        correo: user.correo,
        usuario: user.usuario,
        rol: user.rol,
        ciudad: user.ciudad,
        empresa: user.empresa,
        cargo: user.cargo,
        cedula: user.cedula,
        cursos: (user.studentCourses || []).map(sc => ({
          id: sc.curso?.id,
          titulo: sc.curso?.titulo,
        })).filter(curso => curso.id && curso.titulo)
      }));

      const administradoresQuery = await this.userRepository
        .createQueryBuilder('user')
        .where('user.rol = :rol', { rol: 'ADMIN' })
        .getMany();

      const administradores = administradoresQuery.map(user => ({
        id: user.id,
        nombres: user.nombres,
        apellidos: user.apellidos,
        correo: user.correo,
        usuario: user.usuario,
        rol: user.rol,
        ciudad: user.ciudad,
        empresa: user.empresa,
        cargo: user.cargo,
        asignatura: user.asignatura,
      }));

      const result = {
        estudiantes: estudiantes,
        administradores: administradores,
      };

      return result;

    } catch (error) {
      console.error('❌ Error en getUsuariosPorRol:', error);
      console.error('❌ Stack trace:', error.stack);
      throw new BadRequestException('Error al cargar los usuarios');
    }
  }

  @Post('check-duplicates')
  async checkDuplicates(@Body() checkData: {
    correo?: string;
    usuario?: string;
    cedula?: string;
    celular?: string
  }) {
    return this.usersService.checkDuplicates(checkData);
  }

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async createUser(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getUserById(@Param('id') id: number, @Request() req) { // ✅ AHORA FUNCIONA
    const requestingUser = req.user;

    // ✅ VERIFICAR PERMISOS
    if (requestingUser.userId !== id && requestingUser.rol !== 'ADMIN') {
      throw new UnauthorizedException('No tienes permisos para ver este perfil');
    }

    // ✅ USAR QUERY BUILDER PARA CONTROL PRECISO
    const user = await this.userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.nombres',
        'user.apellidos',
        'user.ciudad',
        'user.empresa',
        'user.cargo',
        'user.rol',
        'user.asignatura',
        'user.activo',
        'user.emailVerified',
        // ✅ Solo admin ve datos sensibles
        ...(requestingUser.rol === 'ADMIN' ? [
          'user.correo',
          'user.usuario',
          'user.cedula',
          'user.celular'
        ] : [
          'user.correo' // ✅ Usuario normal ve su email
        ])
        // ❌ NUNCA incluir: password, tokens
      ])
      .where('user.id = :id', { id })
      .andWhere('user.activo = :activo', { activo: true })
      .getOne();

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
    const result = await this.usersService.delete(id);

    if (!result.success) {
      // Si es error de relaciones, retornar BadRequest con mensaje específico
      if (result.message.includes('No se puede eliminar')) {
        throw new BadRequestException(result.message);
      }
      // Para otros errores
      throw new BadRequestException(result.message);
    }

    return result;
  }
}