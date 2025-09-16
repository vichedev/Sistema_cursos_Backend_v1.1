// src/users/users.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User, Rol } from './user.entity';
import { Repository, In } from 'typeorm';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private repo: Repository<User>) { }

  async findByUsuarioOrCorreo(usuario: string, correo?: string) {
    return this.repo.findOne({ where: [{ usuario }, { correo }] });
  }

  async findByUsuario(usuario: string) {
    return this.repo.findOne({ where: { usuario } });
  }

  async findByCorreo(correo: string) {
    return this.repo.findOne({ where: { correo } });
  }

  // Nuevo método para encontrar por token de verificación
  async findByVerificationToken(token: string) {
    return this.repo.findOne({ where: { emailVerificationToken: token } });
  }

  async findByCedula(cedula: string) {
    return this.repo.findOne({ where: { cedula } });
  }

  async create(data: Partial<User>) {
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

  // Actualiza el método save para poder guardar usuarios modificados
  async save(user: User) {
    return this.repo.save(user);
  }

  async update(id: number, data: Partial<User>) {
    // PROTECCIÓN: No permitir modificar ciertos campos del admin master
    if (id === 1) {
      // Campos que NO se pueden modificar del admin master
      const protectedFields = ['usuario', 'rol', 'correo'];
      const hasProtectedFields = protectedFields.some(field => data[field] !== undefined);
      
      if (hasProtectedFields) {
        throw new BadRequestException('No se pueden modificar campos críticos del administrador principal');
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
    // PROTECCIÓN: No permitir eliminar el admin master
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
}