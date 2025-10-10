import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User, Rol } from './user.entity';
import { Repository, In } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from './dto/create-user.dto'; // ✅ AGREGAR ESTA IMPORTACIÓN

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

  // Nuevo método para encontrar por token de verificación
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

  async create(data: Partial<User> | CreateUserDto) { // ✅ AHORA CreateUserDto ESTÁ DEFINIDO
    // Validar campos obligatorios
    if (!data.correo || !data.usuario || !data.cedula) {
      throw new BadRequestException('Correo, usuario y cédula son campos obligatorios');
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
      throw new BadRequestException('La cédula ya está registrada');
    }

    // Validar si el celular ya existe (si se proporciona)
    if (data.celular) {
      const existingCelular = await this.findByCelular(data.celular);
      if (existingCelular) {
        throw new BadRequestException('El número de celular ya está registrado');
      }
    }

    // Solo hashear si la contraseña existe y NO está ya hasheada
    if (data.password && !data.password.startsWith('$2b$')) {
      data.password = await bcrypt.hash(data.password, 10);
    }

    const user = this.repo.create(data);
    return this.repo.save(user);
  }

  // ... el resto de tus métodos se mantienen igual
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
        throw new BadRequestException('La cédula ya está registrada por otro usuario');
      }
    }

    if (data.celular && data.celular !== currentUser.celular) {
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

  async delete(id: number) {
    if (id === 1) {
      throw new BadRequestException('No se puede eliminar el administrador principal del sistema');
    }

    return this.repo.delete(id);
  }

  async getAll() {
    return this.repo.find();
  }

  async findByIds(ids: number[]) {
    if (!ids?.length) return [];
    return this.repo.find({ where: { id: In(ids) } });
  }

  async findProfesores() {
    return this.repo.find({ where: { rol: 'ADMIN' } });
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
      if (existing) duplicates.cedula = 'Esta cédula ya está registrada';
    }

    if (checkData.celular) {
      const existing = await this.findByCelular(checkData.celular);
      if (existing) duplicates.celular = 'Este celular ya está registrado';
    }

    return duplicates;
  }
}