// src/users/users.controller.ts
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
  ForbiddenException, // ✅ CAMBIAR UnauthorizedException por ForbiddenException
  UsePipes,
  ValidationPipe,
  Request
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator'; // ✅ AGREGAR Roles decorator
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

  // ===============================
  // ✅ MÉTODO DE VALIDACIÓN DE SEGURIDAD
  // ===============================
  private validateOwnership(requestUser: any, targetUserId: number): void {
    const requestUserId = requestUser.userId;
    const requestUserRol = requestUser.rol;

    // ✅ ADMIN tiene acceso completo
    if (requestUserRol === 'ADMIN') {
      return;
    }

    // ✅ Usuario normal solo puede acceder a su propio perfil
    if (requestUserId === targetUserId) {
      return;
    }

    // ❌ Acceso denegado para cualquier otro caso
    throw new ForbiddenException('No tienes permisos para acceder a este recurso');
  }

  // ===============================
  // ✅ ENDPOINTS ORIGINALES CON SEGURIDAD MEJORADA
  // ===============================

  @Get('profesores')
  async getProfesores(@Request() req) {
    // ✅ SOLO ADMIN PUEDE VER PROFESORES
    if (req.user.rol !== 'ADMIN') {
      throw new ForbiddenException('Solo los administradores pueden acceder a esta información');
    }
    return this.usersService.findProfesores();
  }

  @Get('usuarios-por-rol')
  async getUsuariosPorRol(@Request() req) {
    // ✅ SOLO ADMIN PUEDE VER TODOS LOS USUARIOS
    if (req.user.rol !== 'ADMIN') {
      throw new ForbiddenException('Solo los administradores pueden acceder a esta información');
    }

    try {
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
        celular: user.celular,
        emailVerified: user.emailVerified,
        emailVerificationSentAt: user.emailVerificationSentAt,
        emailVerificationToken: user.emailVerificationToken,
        activo: user.activo,
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
        celular: user.celular,
        emailVerified: user.emailVerified,
        emailVerificationSentAt: user.emailVerificationSentAt,
        emailVerificationToken: user.emailVerificationToken,
        activo: user.activo,

      }));

      return {
        estudiantes: estudiantes,
        administradores: administradores,
      };

    } catch (error) {
      console.error('❌ Error en getUsuariosPorRol:', error);
      throw new BadRequestException('Error al cargar los usuarios');
    }
  }

  @Post('check-duplicates')
  async checkDuplicates(
    @Body() checkData: {
      correo?: string;
      usuario?: string;
      cedula?: string;
      celular?: string
    },
    @Request() req // ✅ AGREGAR Request para validación
  ) {
    // ✅ VALIDAR QUE SOLO PUEDE VERIFICAR SUS PROPIOS DATOS O SER ADMIN
    if (req.user.rol !== 'ADMIN') {
      const user = await this.usersService.findById(req.user.userId);
      if (!user) {
        throw new NotFoundException('Usuario no encontrado');
      }

      // Validar que solo verifica sus propios datos
      if (checkData.correo && checkData.correo !== user.correo) {
        throw new ForbiddenException('Solo puedes verificar tu propio correo');
      }
      if (checkData.usuario && checkData.usuario !== user.usuario) {
        throw new ForbiddenException('Solo puedes verificar tu propio usuario');
      }
      if (checkData.cedula && checkData.cedula !== user.cedula) {
        throw new ForbiddenException('Solo puedes verificar tu propia cédula');
      }
      if (checkData.celular && checkData.celular !== user.celular) {
        throw new ForbiddenException('Solo puedes verificar tu propio celular');
      }
    }

    return this.usersService.checkDuplicates(checkData);
  }

  @Post()
  @Roles('ADMIN') // ✅ SOLO ADMIN PUEDE CREAR USUARIOS
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async createUser(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get(':id')
  async getUserById(@Param('id') id: number, @Request() req) {
    // ✅ VALIDAR PERMISOS ANTES DE RETORNAR DATOS
    this.validateOwnership(req.user, id);

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
        ...(req.user.rol === 'ADMIN' ? [
          'user.correo',
          'user.usuario',
          'user.cedula',
          'user.celular'
        ] : [
          'user.correo' // ✅ Usuario normal ve su email
        ])
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
  async updateUser(
    @Param('id') id: number,
    @Body() updateData: Partial<User>,
    @Request() req // ✅ AGREGAR Request para validación
  ) {
    // ✅ VALIDAR PERMISOS ANTES DE ACTUALIZAR
    this.validateOwnership(req.user, id);

    // ✅ PROTECCIÓN ADICIONAL: NO PERMITIR MODIFICAR ROL SI NO ES ADMIN
    if (updateData.rol && req.user.rol !== 'ADMIN') {
      throw new ForbiddenException('No tienes permisos para modificar roles');
    }

    // ✅ PROTECCIÓN: NO PERMITIR DESACTIVARSE A SÍ MISMO
    if (updateData.activo === false && req.user.userId === id) {
      throw new BadRequestException('No puedes desactivar tu propia cuenta');
    }

    return this.usersService.update(id, updateData);
  }

  @Delete(':id')
  async deleteUser(
    @Param('id') id: number,
    @Request() req // ✅ AGREGAR Request para validación
  ) {
    // ✅ VALIDAR PERMISOS ANTES DE ELIMINAR
    this.validateOwnership(req.user, id);

    // ✅ PROTECCIÓN: NO PERMITIR ELIMINARSE A SÍ MISMO
    if (req.user.userId === id) {
      throw new BadRequestException('No puedes eliminar tu propia cuenta');
    }

    // ✅ PROTECCIÓN: NO PERMITIR ELIMINAR ADMIN MASTER (ID: 1)
    if (id === 1) {
      throw new BadRequestException('No se puede eliminar al administrador principal');
    }

    const result = await this.usersService.delete(id);

    if (!result.success) {
      if (result.message.includes('No se puede eliminar')) {
        throw new BadRequestException(result.message);
      }
      throw new BadRequestException(result.message);
    }

    return result;
  }

  // ===============================
  // ✅ ENDPOINTS ADICIONALES SEGUROS (OPCIONALES)
  // ===============================

  @Get('profile/me')
  async getMyProfile(@Request() req) {
    // ✅ ENDPOINT SEGURO PARA OBTENER EL PROPIO PERFIL
    return this.getUserById(req.user.userId, req);
  }

  @Put('profile/me')
  async updateMyProfile(@Body() updateData: Partial<User>, @Request() req) {
    // ✅ ENDPOINT SEGURO PARA ACTUALIZAR EL PROPIO PERFIL
    return this.updateUser(req.user.userId, updateData, req);
  }
}