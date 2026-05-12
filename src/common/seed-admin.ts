// src/common/seed-admin.ts
import { INestApplication } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

export async function seedAdminUser(app: INestApplication) {
  const usersService = app.get(UsersService);
  const config = app.get(ConfigService);

  // Variables del .env
  const adminPassword = config.get<string>('ADMIN_PASSWORD');
  const usuario = config.get<string>('ADMIN_USUARIO');
  const nombres = config.get<string>('ADMIN_NOMBRE');
  const apellidos = config.get<string>('ADMIN_APELLIDO');
  const correo = config.get<string>('ADMIN_EMAIL');
  const cedula = config.get<string>('ADMIN_CEDULA');
  const celular = config.get<string>('ADMIN_CELULAR');
  const pais = config.get<string>('ADMIN_PAIS') || 'EC';
  const asignatura = config.get<string>('ADMIN_ASIGNATURA') || 'Redes y Telecomunicaciones';

  if (!adminPassword || !usuario || !nombres || !apellidos || !correo || !cedula || !celular) {
    throw new Error('Faltan variables de entorno para crear el usuario admin');
  }

  const hash = await bcrypt.hash(adminPassword, 10);

  const existe = await usersService.findByUsuario(usuario);

  if (!existe) {
    await usersService.create({
      nombres,
      apellidos,
      correo,
      usuario,
      cedula,
      celular,
      pais,
      password: hash,
      rol: 'ADMIN',
      asignatura,
      emailVerified: true,
    });
    console.log('Usuario administrador creado y verificado');
  } else if (!existe.emailVerified) {
  
    existe.emailVerified = true;
    await usersService.save(existe);
    console.log('Usuario administrador verificado');
  }
}