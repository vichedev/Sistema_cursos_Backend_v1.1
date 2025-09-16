import { Injectable, UnauthorizedException, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { User, Rol } from '../users/user.entity';
import { MailService } from '../common/mail.service';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService, 
    private jwtService: JwtService,
    private mailService: MailService
  ) { }

  async register(data: RegisterDto) {
    if (await this.usersService.findByUsuario(data.usuario)) {
      throw new BadRequestException('Usuario ya existe');
    }
    if (await this.usersService.findByCorreo(data.correo)) {
      throw new BadRequestException('Correo ya existe');
    }
    if (await this.usersService.findByCedula(data.cedula)) {
      throw new BadRequestException('Cédula ya existe');
    }

    const { rol: cargo, ...rest } = data;

    // Generar token de verificación
    const verificationToken = crypto.randomBytes(32).toString('hex');

    const userData: Partial<User> = {
      ...rest,
      password: data.password,
      rol: 'ESTUDIANTE' as Rol,
      cargo,
      emailVerified: false, // Por defecto no verificado
      emailVerificationToken: verificationToken,
      emailVerificationSentAt: new Date()
    };

    const user = await this.usersService.create(userData);
    
    // Enviar correo de verificación (solo token, no URL completa)
    try {
      await this.mailService.sendVerificationEmail(
        user.correo, 
        verificationToken, 
        `${user.nombres} ${user.apellidos}`
      );
    } catch (error) {
      console.error('Error enviando correo de verificación:', error);
      // Opcional: podrías eliminar al usuario si no se puede enviar el correo
    }

    return { 
      message: 'Usuario creado. Por favor verifica tu correo electrónico para activar tu cuenta.',
      userId: user.id 
    };
  }

  async verifyEmail(token: string) {
    if (!token) {
      throw new BadRequestException('Token de verificación requerido');
    }

    const user = await this.usersService.findByVerificationToken(token);
    if (!user) {
      throw new NotFoundException('Token de verificación inválido o ya utilizado');
    }

    // Verificar expiración (24 horas)
    if (user.emailVerificationSentAt) {
      const sentTime = new Date(user.emailVerificationSentAt).getTime();
      const now = new Date().getTime();
      const hoursPassed = (now - sentTime) / (1000 * 60 * 60);
      
      if (hoursPassed > 24) {
        throw new BadRequestException('Token de verificación expirado. Por favor solicita un nuevo correo de verificación.');
      }
    }

    // Actualizar usuario como verificado
    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationSentAt = null;
    
    await this.usersService.save(user);

    return { message: 'Correo verificado exitosamente. Ahora puedes iniciar sesión.' };
  }

  async resendVerificationEmail(email: string) {
    const user = await this.usersService.findByCorreo(email);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (user.emailVerified) {
      throw new BadRequestException('El correo ya ha sido verificado');
    }

    // Generar nuevo token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    
    user.emailVerificationToken = verificationToken;
    user.emailVerificationSentAt = new Date();
    
    await this.usersService.save(user);
    
    // Enviar correo de verificación (solo token, no URL completa)
    await this.mailService.sendVerificationEmail(
      user.correo, 
      verificationToken, 
      `${user.nombres} ${user.apellidos}`
    );

    return { message: 'Correo de verificación reenviado. Por favor revisa tu bandeja de entrada.' };
  }

  async login(data: LoginDto) {
    console.log('🔐 Intento de login con usuario:', data.usuario);

    // Buscar por usuario O correo
    const user = await this.usersService.findByUsuario(data.usuario) ||
      await this.usersService.findByCorreo(data.usuario);

    if (!user) {
      console.log('❌ Usuario no encontrado');
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }

    console.log('👤 Usuario encontrado:', user.usuario);
    console.log('🔐 Hash en BD:', user.password);
    console.log('🔑 Contraseña ingresada:', data.password);

    // Verificar el hash
    const isPasswordValid = await bcrypt.compare(data.password, user.password);
    console.log('✅ Contraseña válida:', isPasswordValid);

    if (!isPasswordValid) {
      console.log('❌ Contraseña incorrecta');
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }

    // Verificar si el correo está verificado
    if (!user.emailVerified) {
      throw new ForbiddenException('Cuenta no verificada. Por favor verifica tu correo electrónico antes de iniciar sesión.');
    }

    const payload = {
      sub: user.id,
      rol: user.rol
    };

    return {
      token: this.jwtService.sign(payload),
      rol: user.rol,
      cargo: user.cargo,
      usuario: user.usuario,
      nombres: user.nombres,
      userId: user.id,
    };
  }
}