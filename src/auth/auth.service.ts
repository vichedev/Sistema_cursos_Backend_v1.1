import { Injectable, UnauthorizedException, BadRequestException, NotFoundException, ForbiddenException, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { User, Rol } from '../users/user.entity';
import { MailQueueService } from '../common/mail-queue.service';
import { MailService } from '../common/mail.service';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private mailQueueService: MailQueueService,
    @InjectRepository(User) private userRepo: Repository<User>,
    private mailService: MailService
  ) { }

  async register(data: RegisterDto) {
    let user: User;
    let verificationToken: string;

    try {
      console.log('🔵 INICIANDO REGISTRO para:', data.correo);

      if (await this.usersService.findByUsuario(data.usuario)) {
        throw new BadRequestException('Usuario ya existe');
      }
      if (await this.usersService.findByCorreo(data.correo)) {
        throw new BadRequestException('Correo ya existe');
      }
      if (await this.usersService.findByCedula(data.cedula)) {
        throw new BadRequestException('Cédula ya existe');
      }

      const { ...rest } = data;

      verificationToken = crypto.randomBytes(32).toString('hex');

      const userData: Partial<User> = {
        ...rest,
        password: data.password,
        rol: 'ESTUDIANTE' as Rol,
        cargo: data.cargo,
        emailVerified: false,
        emailVerificationToken: verificationToken,
        emailVerificationSentAt: new Date()
      };

      user = await this.usersService.create(userData);
      console.log('🟢 USUARIO CREADO - ID:', user.id);

    } catch (error) {
      console.log('🔴 ERROR en creación de usuario:', error.message);
      throw error;
    }

    console.log('📧 AGREGANDO CORREO A COLA...');

    this.mailQueueService.addToQueue(
      user.correo,
      verificationToken,
      `${user.nombres} ${user.apellidos}`
    );

    console.log('✅ REGISTRO COMPLETADO - Correo en cola de envío');

    return {
      success: true,
      message: '✅ Usuario registrado exitosamente. Recibirás el correo de verificación en los próximos segundos.',
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

    if (user.emailVerificationSentAt) {
      const sentTime = new Date(user.emailVerificationSentAt).getTime();
      const now = new Date().getTime();
      const hoursPassed = (now - sentTime) / (1000 * 60 * 60);

      if (hoursPassed > 24) {
        throw new BadRequestException('Token de verificación expirado. Por favor solicita un nuevo correo de verificación.');
      }
    }

    user.emailVerified = true;
    user.emailVerificationToken = null;

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

    const verificationToken = crypto.randomBytes(32).toString('hex');

    user.emailVerificationToken = verificationToken;
    user.emailVerificationSentAt = new Date();

    await this.usersService.save(user);

    console.log('📧 REENVÍO - Agregando a cola...');
    this.mailQueueService.addToQueue(
      user.correo,
      verificationToken,
      `${user.nombres} ${user.apellidos}`
    );

    return { message: 'Correo de verificación reenviado. Por favor revisa tu bandeja de entrada.' };
  }

  async login(data: LoginDto) {
    const user = await this.usersService.findByUsuario(data.usuario) ||
      await this.usersService.findByCorreo(data.usuario);

    if (!user) {
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }

    const isPasswordValid = await bcrypt.compare(data.password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }

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

  async verifyUserManually(userId: number) {
    this.logger.log(`🔧 Verificación manual solicitada para usuario ID: ${userId}`);

    const user = await this.userRepo.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (user.emailVerified) {
      throw new BadRequestException('El usuario ya está verificado');
    }

    await this.userRepo.update(userId, {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationSentAt: new Date(),
      activo: true
    });

    this.logger.log(`✅ Usuario ${user.correo} verificado manualmente por administrador`);

    try {
      await this.mailService.sendMail(
        user.correo,
        'Cuenta verificada - Cursos MAAT',
        `
        <div style="font-family: Arial, sans-serif; color:#222;">
          <h2>¡Cuenta verificada exitosamente!</h2>
          <p>Hola <b>${user.nombres}</b>,</p>
          <p>Tu cuenta ha sido verificada manualmente por nuestro equipo administrativo.</p>
          <p>Ahora puedes iniciar sesión y acceder a todos los cursos disponibles.</p>
          <div style="margin-top: 20px; padding: 15px; background-color: #f0f9ff; border-radius: 5px;">
            <p><b>📧 Correo:</b> ${user.correo}</p>
            <p><b>👤 Usuario:</b> ${user.usuario}</p>
            <p><b>🕐 Fecha de verificación:</b> ${new Date().toLocaleString('es-ES')}</p>
          </div>
          <br>
          <p>¡Bienvenido a Cursos MAAT!</p>
          <hr>
          <small>Sistema de Cursos MAAT</small>
        </div>
        `
      );
      this.logger.log(`📧 Notificación enviada a ${user.correo}`);
    } catch (emailError) {
      this.logger.error(`❌ Error enviando notificación a ${user.correo}:`, emailError.message);
    }

    return {
      success: true,
      message: 'Usuario verificado manualmente con éxito',
      user: {
        id: user.id,
        nombres: user.nombres,
        apellidos: user.apellidos,
        correo: user.correo,
        emailVerified: true
      }
    };
  }

  // ================================================================
  // ✅ PASO 1 — El estudiante solicita restablecer su contraseña
  // Recibe el correo, genera un token seguro con expiración de 1 hora
  // y envía el link al correo del usuario
  // ================================================================
  async requestPasswordReset(correo: string) {
    const user = await this.usersService.findByCorreo(correo);

    // ✅ Por seguridad: siempre responder igual aunque el correo no exista
    // Esto evita que alguien pueda descubrir qué correos están registrados
    if (!user) {
      return {
        success: true,
        message: 'Si el correo está registrado, recibirás las instrucciones en breve.'
      };
    }

    // Generar token seguro de 32 bytes
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora desde ahora

    // Guardar token y expiración en el usuario
    await this.userRepo.update(user.id, {
      passwordResetToken: resetToken,
      passwordResetExpiresAt: expiresAt,
    });

    // Construir link con el token
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    // Enviar correo con el link
    await this.mailService.sendMail(
      user.correo,
      '🔐 Restablecer contraseña - Cursos MAAT',
      `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <h2 style="color:#2563eb;margin-bottom:20px">🔐 Restablecer tu contraseña</h2>
  <p>Hola <strong>${user.nombres}</strong>,</p>
  <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
  <p>Haz clic en el botón para crear una nueva contraseña:</p>
  <div style="text-align:center;margin:30px 0">
    <a href="${resetUrl}"
       style="background:#2563eb;color:white;padding:14px 32px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold;font-size:16px">
      Restablecer contraseña
    </a>
  </div>
  <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px;margin:20px 0">
    <p style="margin:0;color:#92400e;font-size:14px">
      ⚠️ Este enlace expira en <strong>1 hora</strong>. Si no solicitaste este cambio, ignora este correo.
    </p>
  </div>
  <p style="color:#6b7280;font-size:13px">Si el botón no funciona, copia este enlace: ${resetUrl}</p>
  <hr style="margin:25px 0">
  <p style="color:#9ca3af;font-size:12px">Cursos MAAT — Si no solicitaste esto, puedes ignorar este mensaje.</p>
</div>
      `.trim()
    );

    this.logger.log(`📧 Correo de recuperación enviado a ${user.correo}`);

    return {
      success: true,
      message: 'Si el correo está registrado, recibirás las instrucciones en breve.'
    };
  }

  // ================================================================
  // ✅ PASO 2 — El estudiante ingresa su nueva contraseña
  // Valida que el token sea válido y no haya expirado,
  // luego actualiza la contraseña con hash bcrypt
  // ================================================================
  async resetPassword(token: string, newPassword: string) {
    if (!token || !newPassword) {
      throw new BadRequestException('Token y nueva contraseña son requeridos');
    }

    if (newPassword.length < 6) {
      throw new BadRequestException('La contraseña debe tener al menos 6 caracteres');
    }

    // Buscar usuario con ese token de reset
    const user = await this.userRepo.findOne({
      where: { passwordResetToken: token }
    });

    if (!user) {
      throw new BadRequestException('Token inválido o ya utilizado');
    }

    // Verificar que el token no haya expirado
    if (!user.passwordResetExpiresAt || new Date() > user.passwordResetExpiresAt) {
      throw new BadRequestException('El enlace ha expirado. Por favor solicita uno nuevo.');
    }

    // Hashear la nueva contraseña
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Actualizar contraseña y limpiar tokens de reset
    await this.userRepo.update(user.id, {
      password: hashedPassword,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
    });

    this.logger.log(`✅ Contraseña restablecida para ${user.correo}`);

    // Notificar al usuario que su contraseña fue cambiada
    try {
      await this.mailService.sendMail(
        user.correo,
        '✅ Contraseña actualizada - Cursos MAAT',
        `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <h2 style="color:#16a34a;margin-bottom:20px">✅ Contraseña actualizada</h2>
  <p>Hola <strong>${user.nombres}</strong>,</p>
  <p>Tu contraseña ha sido restablecida exitosamente.</p>
  <p>Ya puedes iniciar sesión con tu nueva contraseña.</p>
  <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px;margin:20px 0">
    <p style="margin:0;color:#166534;font-size:14px">
      🔒 Si no realizaste este cambio, contacta a soporte inmediatamente.
    </p>
  </div>
  <hr style="margin:25px 0">
  <p style="color:#9ca3af;font-size:12px">Cursos MAAT</p>
</div>
        `.trim()
      );
    } catch (emailError) {
      this.logger.error(`❌ Error enviando confirmación a ${user.correo}:`, emailError.message);
      // No lanzar error, el reset ya se completó correctamente
    }

    return {
      success: true,
      message: 'Contraseña restablecida exitosamente. Ya puedes iniciar sesión.'
    };
  }
}