import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User, Rol } from './user.entity';
import { Repository, In } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from './dto/create-user.dto';
import { StudentCourse } from '../courses/student-course.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private repo: Repository<User>) { }

  async findByUsuarioOrCorreo(usuario: string, correo?: string) {
    return this.repo.findOne({ where: [{ usuario }, { correo }] });
  }

  async findByUsuario(usuario: string) {
    if (!usuario) return null;
    return this.repo.findOne({ where: { usuario } });
  }

  async findByCorreo(correo: string) {
    if (!correo) return null;
    return this.repo.findOne({ where: { correo } });
  }

  async findByVerificationToken(token: string) {
    return this.repo.findOne({ where: { emailVerificationToken: token } });
  }

  async findByCedula(cedula: string) {
    if (!cedula) return null;
    return this.repo.findOne({ where: { cedula } });
  }

  async findByCelular(celular: string) {
    if (!celular) return null;
    return this.repo.findOne({ where: { celular } });
  }

  async create(data: Partial<User> | CreateUserDto) {
    // Validar campos obligatorios
    if (!data.correo || !data.usuario || !data.cedula) {
      throw new BadRequestException('Correo, usuario y cédula son campos obligatorios');
    }

    // ✅ VALIDAR PAÍS (obligatorio)
    if (!data.pais) {
      throw new BadRequestException('El país es obligatorio');
    }

    // ✅ VALIDAR CELULAR
    if (!data.celular) {
      throw new BadRequestException('El celular es obligatorio');
    }

    // ✅ NORMALIZAR CELULAR: Eliminar 0 después del código de país
    // Ejemplo: +5930991234567 → +593991234567
    data.celular = data.celular.replace(/^(\+\d{1,3})0+/, '$1');

    // ✅ VALIDAR FORMATO INTERNACIONAL
    const phoneRegex = /^\+\d{1,3}\d{7,15}$/;
    if (!phoneRegex.test(data.celular)) {
      throw new BadRequestException(
        `El formato del celular es inválido. Debe incluir código de país (ej: +593991234567)`
      );
    }

    // ✅ VALIDACIÓN ESPECÍFICA POR PAÍS (longitud correcta)
    const phoneValidations = {
      EC: { length: 13, message: 'El celular ecuatoriano debe tener 9 dígitos después del +593' },
      CO: { length: 13, message: 'El celular colombiano debe tener 10 dígitos después del +57' },
      CL: { length: 12, message: 'El celular chileno debe tener 9 dígitos después del +56' },
      AR: { length: 13, message: 'El celular argentino debe tener 10 dígitos después del +54' },
      PE: { length: 12, message: 'El celular peruano debe tener 9 dígitos después del +51' },
      MX: { length: 13, message: 'El celular mexicano debe tener 10 dígitos después del +52' },
      UY: { length: 12, message: 'El celular uruguayo debe tener 8 dígitos después del +598' },
      PY: { length: 13, message: 'El celular paraguayo debe tener 9 dígitos después del +595' },
      BO: { length: 12, message: 'El celular boliviano debe tener 8 dígitos después del +591' },
      VE: { length: 13, message: 'El celular venezolano debe tener 10 dígitos después del +58' },
    };

    const validation = phoneValidations[data.pais];
    if (validation && data.celular.length !== validation.length) {
      throw new BadRequestException(validation.message);
    }

    // Validar si el correo ya existe
    const existingEmail = await this.findByCorreo(data.correo);
    if (existingEmail) {
      throw new BadRequestException('El correo electrónico ya está registrado');
    }

    // Validar si el usuario ya existe
    const existingUsuario = await this.findByUsuario(data.usuario);
    if (existingUsuario) {
      throw new BadRequestException('El nombre de usuario ya está en uso');
    }

    // Validar si la cédula ya existe
    const existingCedula = await this.findByCedula(data.cedula);
    if (existingCedula) {
      throw new BadRequestException('La identificación ya está registrada');
    }

    // ✅ Validar si el celular ya existe (después de normalizar)
    const existingCelular = await this.findByCelular(data.celular);
    if (existingCelular) {
      throw new BadRequestException('El número de celular ya está registrado');
    }

    // ✅ Validar cargo si viene (opcional)
    if (data.cargo && !['Gerente', 'Técnico'].includes(data.cargo)) {
      throw new BadRequestException('El cargo debe ser "Gerente" o "Técnico"');
    }

    // Solo hashear si la contraseña existe y NO está ya hasheada
    if (data.password && !data.password.startsWith('$2b$')) {
      data.password = await bcrypt.hash(data.password, 10);
    }

    const user = this.repo.create(data);
    return this.repo.save(user);
  }

  async findById(id: number) {
    return this.repo.findOne({ where: { id } });
  }

  async save(user: User) {
    return this.repo.save(user);
  }

  async update(id: number, data: Partial<User>) {
    // PROTECCIÓN: No permitir modificar ciertos campos del admin master
    if (id === 1) {
      const protectedFields = ['usuario', 'rol', 'correo'];
      const hasProtectedFields = protectedFields.some(field => data[field] !== undefined);

      if (hasProtectedFields) {
        throw new BadRequestException('No se pueden modificar campos críticos del administrador principal');
      }
    }

    // Obtener el usuario actual para comparar
    const currentUser = await this.findById(id);
    if (!currentUser) {
      throw new BadRequestException('Usuario no encontrado');
    }

    // ✅ NORMALIZAR CELULAR si viene en la actualización
    if (data.celular) {
      data.celular = data.celular.replace(/^(\+\d{1,3})0+/, '$1');
    }

    // Validar duplicados solo si los campos cambian
    if (data.correo && data.correo !== currentUser.correo) {
      const existing = await this.findByCorreo(data.correo);
      if (existing && existing.id !== id) {
        throw new BadRequestException('El correo electrónico ya está registrado por otro usuario');
      }
    }

    if (data.usuario && data.usuario !== currentUser.usuario) {
      const existing = await this.findByUsuario(data.usuario);
      if (existing && existing.id !== id) {
        throw new BadRequestException('El nombre de usuario ya está en uso por otro usuario');
      }
    }

    if (data.cedula && data.cedula !== currentUser.cedula) {
      const existing = await this.findByCedula(data.cedula);
      if (existing && existing.id !== id) {
        throw new BadRequestException('La identificación ya está registrada por otro usuario');
      }
    }

    // ✅ VALIDAR CELULAR INTERNACIONAL EN ACTUALIZACIÓN
    if (data.celular && data.celular !== currentUser.celular) {
      // Validar formato internacional
      const phoneRegex = /^\+\d{1,3}\d{7,15}$/;
      if (!phoneRegex.test(data.celular)) {
        throw new BadRequestException(
          'El formato del celular es inválido. Debe incluir código de país (ej: +593991234567)'
        );
      }

      // ✅ Validar longitud según país (usar el país actual del usuario o el nuevo)
      const paisActual = data.pais || currentUser.pais;
      const phoneValidations = {
        EC: 13, CO: 13, CL: 12, AR: 13, PE: 12, MX: 13, UY: 12, PY: 13, BO: 12, VE: 13
      };

      const longitudEsperada = phoneValidations[paisActual];
      if (longitudEsperada && data.celular.length !== longitudEsperada) {
        throw new BadRequestException(`El celular no tiene la longitud correcta para el país seleccionado`);
      }

      // Validar si ya existe
      const existing = await this.findByCelular(data.celular);
      if (existing && existing.id !== id) {
        throw new BadRequestException('El número de celular ya está registrado por otro usuario');
      }
    }

    // Si se está actualizando la contraseña, hashearla antes de guardar
    if (data.password && !data.password.startsWith('$2b$')) {
      data.password = await bcrypt.hash(data.password, 10);
    }

    await this.repo.update(id, data);
    return this.findById(id);
  }

  async delete(id: number): Promise<{ success: boolean; message: string }> {
    if (id === 1) {
      throw new BadRequestException('No se puede eliminar el administrador principal del sistema');
    }

    try {
      const result = await this.repo.delete(id);

      if (result.affected === 0) {
        return {
          success: false,
          message: 'Usuario no encontrado'
        };
      }

      return {
        success: true,
        message: 'Estudiante eliminado correctamente'
      };

    } catch (error) {
      // Manejar error de violación de clave foránea
      if (error.code === '23503') {
        return {
          success: false,
          message: 'No se puede eliminar el estudiante porque tiene cursos, cupones u otra información asociada. Primero elimine los registros relacionados.'
        };
      }

      // Para otros errores de base de datos
      console.error('❌ Error al eliminar usuario:', error);
      return {
        success: false,
        message: 'Error interno del servidor al intentar eliminar el estudiante'
      };
    }
  }

  async getAll() {
    return this.repo.find();
  }

  async findByIds(ids: number[]) {
    if (!ids?.length) return [];
    return this.repo.find({ where: { id: In(ids) } });
  }

  async findProfesores() {
    return this.repo.find({
      where: { rol: In(['ADMIN', 'PROFESOR']), activo: true },
      select: {
        id: true,
        nombres: true,
        apellidos: true,
        asignatura: true,
        ciudad: true,
        empresa: true,
        cargo: true,
        rol: true,
        activo: true,
        pais: true, // ✅ INCLUIR PAÍS
        // ❌ NO incluir: correo, usuario, cedula, celular, password, etc.
      }
    });
  }

  async checkDuplicates(checkData: { correo?: string; usuario?: string; cedula?: string; celular?: string }) {
    const duplicates: any = {};

    if (checkData.correo) {
      const existing = await this.findByCorreo(checkData.correo);
      if (existing) duplicates.correo = 'Este correo ya está registrado';
    }

    if (checkData.usuario) {
      const existing = await this.findByUsuario(checkData.usuario);
      if (existing) duplicates.usuario = 'Este usuario ya está en uso';
    }

    if (checkData.cedula) {
      const existing = await this.findByCedula(checkData.cedula);
      if (existing) duplicates.cedula = 'Esta identificación ya está registrada';
    }

    if (checkData.celular) {
      const existing = await this.findByCelular(checkData.celular);
      if (existing) duplicates.celular = 'Este celular ya está registrado';
    }

    return duplicates;
  }

  async getUsuariosPorRolCompleto() {
    // Obtener estudiantes con sus datos completos (sin cursos)
    const estudiantes = await this.repo.find({
      where: { rol: 'ESTUDIANTE', activo: true },
      select: {
        id: true,
        cedula: true,
        nombres: true,
        apellidos: true,
        correo: true,
        celular: true,
        pais: true, // ✅ INCLUIR PAÍS
        ciudad: true,
        empresa: true,
        cargo: true,
        usuario: true,
        rol: true,
        activo: true,
        emailVerified: true,
        emailEstado: true,
        emailValidadoEn: true,
        suspendido: true,
        motivoSuspension: true,
        emailVerificationSentAt: true,
      }
    });

    // Obtener administradores
    const administradores = await this.repo.find({
      where: { rol: In(['ADMIN', 'PROFESOR']), activo: true },
      select: {
        id: true,
        cedula: true,
        nombres: true,
        apellidos: true,
        correo: true,
        celular: true,
        pais: true, // ✅ INCLUIR PAÍS
        ciudad: true,
        empresa: true,
        cargo: true,
        usuario: true,
        asignatura: true,
        rol: true,
        activo: true,
        emailVerified: true,
        emailEstado: true,
        emailValidadoEn: true,
      }
    });

    const estudiantesConCursos = await Promise.all(
      estudiantes.map(async (estudiante) => {
        try {
          const studentCourses = await this.repo.manager
            .getRepository(StudentCourse)
            .find({
              where: { estudianteId: estudiante.id },
              relations: ['curso']
            });

          const cursos = studentCourses
            .filter(sc => sc.curso && sc.curso.activo)
            .map(sc => ({
              id: sc.curso.id,
              titulo: sc.curso.titulo,
              descripcion: sc.curso.descripcion,
              imagen: sc.curso.imagen,
              tipo: sc.curso.tipo,
              cupos: sc.curso.cupos,
              link: sc.curso.link,
              precio: sc.curso.precio,
              fecha: sc.curso.fecha,
              hora: sc.curso.hora,
              activo: sc.curso.activo,
            }));

          return {
            ...estudiante,
            cursos: cursos || []
          };
        } catch (error) {
          console.error(`❌ Error obteniendo cursos para estudiante ${estudiante.id}:`, error);
          return {
            ...estudiante,
            cursos: []
          };
        }
      })
    );

    return {
      estudiantes: estudiantesConCursos,
      administradores
    };
  }
}