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
  Request,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join } from 'path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator'; // ✅ AGREGAR Roles decorator
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { EmailValidatorService } from '../common/email-validator.service';
import { MailService } from '../common/mail.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

// Opciones de subida para la foto de perfil
const avatarUploadOptions = {
  storage: diskStorage({
    destination: join(__dirname, '..', '..', 'uploads'),
    filename: (_req: any, file: Express.Multer.File, cb: any) => {
      cb(null, `avatar-${Date.now()}-${file.originalname.replace(/\s/g, '_')}`);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024 }, // 4 MB
  fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new BadRequestException('Solo se permiten imágenes JPEG, PNG, WebP o GIF'), false);
    }
    cb(null, true);
  },
};

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly emailValidator: EmailValidatorService,
    private readonly mail: MailService,
    private readonly whatsapp: WhatsappService,
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
        pais: user.pais,
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
        pais: user.pais,
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
        'user.foto',
        'user.pais',
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
  async updateMyProfile(@Body() updateData: any, @Request() req) {
    // ✅ Solo se permiten campos seguros de auto-edición (no correo/usuario/cédula/rol)
    const allowed = ['nombres', 'apellidos', 'ciudad', 'empresa', 'cargo', 'pais'];
    const safe: any = {};
    for (const k of allowed) {
      if (updateData?.[k] !== undefined) safe[k] = updateData[k];
    }
    if (!safe.nombres && safe.nombres !== undefined && !String(safe.nombres).trim()) {
      throw new BadRequestException('El nombre no puede estar vacío');
    }
    await this.usersService.update(req.user.userId, safe);
    return this.getUserById(req.user.userId, req);
  }

  // ===============================
  // ✅ VALIDACIÓN DE CORREOS (¿el correo existe?)
  // ===============================

  /** Valida un correo puntual (sintaxis + dominio MX + sondeo SMTP). No guarda nada. */
  @Roles('ADMIN')
  @Post('validate-email')
  async validateEmail(@Body('email') email: string) {
    if (!email) throw new BadRequestException('Correo requerido');
    return { success: true, data: await this.emailValidator.validate(email, { smtp: true }) };
  }

  /** Valida en lote los correos de varios usuarios (por ids) y guarda el resultado. */
  @Roles('ADMIN')
  @Post('validate-emails-bulk')
  async validateEmailsBulk(@Body('ids') ids: number[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('Lista de ids requerida');
    }
    const resumen: Record<string, number> = { valido: 0, riesgoso: 0, invalido: 0 };
    for (const rawId of ids.slice(0, 500)) {
      const id = Number(rawId);
      const user = await this.userRepository.findOne({ where: { id } });
      if (!user) continue;
      const r = await this.emailValidator.validate(user.correo, { smtp: true });
      await this.usersService.update(id, {
        emailEstado: r.estado,
        emailValidadoEn: new Date(),
      } as Partial<User>);
      resumen[r.estado] = (resumen[r.estado] || 0) + 1;
    }
    return { success: true, resumen };
  }

  /** Valida el correo de un usuario y guarda el resultado (estado real del correo). */
  @Roles('ADMIN')
  @Post(':id/validate-email')
  async validateUserEmail(@Param('id') id: number, @Request() req) {
    this.validateOwnership(req.user, Number(id));
    const user = await this.userRepository.findOne({ where: { id: Number(id) } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const result = await this.emailValidator.validate(user.correo, { smtp: true });
    await this.usersService.update(Number(id), {
      emailEstado: result.estado,
      emailValidadoEn: new Date(),
    } as Partial<User>);
    return { success: true, data: result };
  }

  /** Suspende la cuenta de un usuario (no podrá iniciar sesión hasta reactivarla). */
  @Roles('ADMIN')
  @Post(':id/suspender')
  async suspenderUsuario(@Param('id') id: number, @Body('motivo') motivo: string) {
    const user = await this.userRepository.findOne({ where: { id: Number(id) } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.id === 1) throw new BadRequestException('No se puede suspender al administrador principal');
    await this.usersService.update(Number(id), {
      suspendido: true,
      motivoSuspension: (motivo || 'Datos pendientes de revalidación').trim().slice(0, 200),
      suspendidoEn: new Date(),
    } as Partial<User>);
    return { success: true, message: 'Cuenta suspendida' };
  }

  /** Reactiva la cuenta de un usuario suspendido. */
  @Roles('ADMIN')
  @Post(':id/reactivar')
  async reactivarUsuario(@Param('id') id: number) {
    const user = await this.userRepository.findOne({ where: { id: Number(id) } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    await this.usersService.update(Number(id), {
      suspendido: false,
      motivoSuspension: null,
      suspendidoEn: null,
    } as Partial<User>);
    return { success: true, message: 'Cuenta reactivada' };
  }

  /**
   * Contacta al estudiante para pedirle que actualice su correo a uno válido.
   * canal: 'email' (al correo registrado) o 'whatsapp' (vía la sesión conectada).
   */
  @Roles('ADMIN')
  @Post(':id/solicitar-correo')
  async solicitarCorreo(
    @Param('id') id: number,
    @Body('canal') canal: 'email' | 'whatsapp',
  ) {
    const user = await this.userRepository.findOne({ where: { id: Number(id) } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const nombre = `${user.nombres} ${user.apellidos}`.trim();
    const textoWa =
      `Hola ${user.nombres}, te escribimos de MAAT Cursos. ` +
      `Necesitamos actualizar tu correo electrónico porque el registrado no es válido o no pudo verificarse. ` +
      `Por favor respóndenos con un correo válido para activar/mantener tu cuenta. ¡Gracias!`;

    if (canal === 'whatsapp') {
      if (!user.celular) {
        throw new BadRequestException('Este estudiante no tiene número de WhatsApp');
      }
      try {
        await this.whatsapp.sendText(user.celular, textoWa);
      } catch (e) {
        throw new BadRequestException(`No se pudo enviar el WhatsApp: ${e.message}`);
      }
      return { success: true, message: 'Mensaje de WhatsApp enviado' };
    }

    // Email (por defecto)
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111827">
        <h2 style="color:#2563eb">Actualiza tu correo electrónico</h2>
        <p>Hola <b>${nombre}</b>,</p>
        <p>Detectamos que el correo registrado en tu cuenta de <b>MAAT Cursos</b> no es válido o no pudo verificarse.</p>
        <p>Para no perder el acceso a tus cursos, por favor contáctanos y actualiza tus datos con un correo válido.</p>
        <p style="color:#6b7280;font-size:0.9rem">Si no realizas esta actualización, tu cuenta podría ser suspendida.</p>
      </div>`;
    // En segundo plano (no bloquear la respuesta)
    this.mail
      .sendMail(user.correo, 'Actualiza tu correo — MAAT Cursos', html)
      .catch(() => undefined);
    return { success: true, message: 'Correo de solicitud encolado' };
  }

  /** El usuario sube/cambia su foto de perfil. */
  @Post('profile/avatar')
  @UseInterceptors(FileInterceptor('foto', avatarUploadOptions))
  async updateMyAvatar(@UploadedFile() file: Express.Multer.File, @Request() req) {
    if (!file) throw new BadRequestException('No se recibió ninguna imagen');
    await this.usersService.update(req.user.userId, { foto: file.filename } as Partial<User>);
    return { success: true, foto: file.filename, message: 'Foto de perfil actualizada' };
  }
}