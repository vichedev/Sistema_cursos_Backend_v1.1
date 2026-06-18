// src/auth/auth.service.ts
import {
  Injectable, UnauthorizedException, BadRequestException,
  NotFoundException, ForbiddenException, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { User, Rol } from '../users/user.entity';
import { AccessLog } from './access-log.entity';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { MailQueueService } from '../common/mail-queue.service';
import { MailService } from '../common/mail.service';
import { EmailValidatorService } from '../common/email-validator.service';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private mailQueueService: MailQueueService,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(AccessLog) private accessLogRepo: Repository<AccessLog>,
    private mailService: MailService,
    private whatsappService: WhatsappService,
    private emailValidator: EmailValidatorService,
  ) { }

  /** Registra (en segundo plano) un intento de acceso para monitoreo. */
  private recordAccess(data: Partial<AccessLog>) {
    this.accessLogRepo
      .save(this.accessLogRepo.create(data))
      .catch((e) => this.logger.warn(`No se pudo registrar log de acceso: ${e.message}`));
  }

  // ── Helpers privados ──────────────────────────────────────────────────────

  private signAccessToken(userId: number, rol: string): string {
    return this.jwtService.sign(
      { sub: userId, rol },
      {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: this.configService.get<string>('JWT_EXPIRES_IN') || '15m',
      },
    );
  }

  private signRefreshToken(userId: number, rol: string): string {
    return this.jwtService.sign(
      { sub: userId, rol },
      {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d',
      },
    );
  }

  // ── Register ──────────────────────────────────────────────────────────────

  async register(data: RegisterDto) {
    let user: User;
    let verificationToken: string;

    try {
      console.log('🔵 INICIANDO REGISTRO para:', data.correo);

      if (await this.usersService.findByUsuario(data.usuario)) {
        throw new BadRequestException('Usuario ya existe');
      }
      // ✅ Validar que el correo sea real (sintaxis + dominio con servidor de correo)
      const val = await this.emailValidator.validate(data.correo, { smtp: false });
      if (val.estado === 'invalido') {
        throw new BadRequestException(
          val.sugerencia
            ? `Correo no válido: ${val.razon}`
            : `Correo no válido: ${val.razon}. Usa un correo real al que tengas acceso.`,
        );
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
        emailVerificationSentAt: new Date(),
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
      `${user.nombres} ${user.apellidos}`,
    );

    console.log('✅ REGISTRO COMPLETADO - Correo en cola de envío');

    return {
      success: true,
      message: '✅ Usuario registrado exitosamente. Recibirás el correo de verificación en los próximos segundos.',
      userId: user.id,
    };
  }

  // ── Login — ahora devuelve accessToken + refreshToken ─────────────────────

  async login(data: LoginDto, meta: { ip?: string; userAgent?: string } = {}) {
    const ident = data.usuario;
    const base = { identificador: ident, ip: meta.ip || null, userAgent: meta.userAgent || null };

    const user =
      (await this.usersService.findByUsuario(data.usuario)) ||
      (await this.usersService.findByCorreo(data.usuario));

    if (!user) {
      this.recordAccess({ ...base, exito: false, motivo: 'Usuario no encontrado' });
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }

    const userInfo = {
      ...base,
      userId: user.id,
      nombres: `${user.nombres} ${user.apellidos}`.trim(),
      rol: user.rol,
    };

    const isPasswordValid = await bcrypt.compare(data.password, user.password);
    if (!isPasswordValid) {
      this.recordAccess({ ...userInfo, exito: false, motivo: 'Contraseña incorrecta' });
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }

    if (user.suspendido) {
      this.recordAccess({ ...userInfo, exito: false, motivo: 'Cuenta suspendida' });
      throw new ForbiddenException(
        user.motivoSuspension
          ? `Cuenta suspendida: ${user.motivoSuspension}. Contacta a soporte para revalidar tus datos y reactivarla.`
          : 'Tu cuenta está suspendida. Contacta a soporte para revalidar tus datos y reactivarla.',
      );
    }

    if (!user.emailVerified) {
      this.recordAccess({ ...userInfo, exito: false, motivo: 'Cuenta no verificada' });
      throw new ForbiddenException(
        'Cuenta no verificada. Por favor verifica tu correo electrónico antes de iniciar sesión.',
      );
    }

    this.recordAccess({ ...userInfo, exito: true, motivo: 'Ingreso correcto' });

    const accessToken = this.signAccessToken(user.id, user.rol);
    const refreshToken = this.signRefreshToken(user.id, user.rol);

    return {
      // ✅ Mantener "token" para no romper el frontend existente
      token: accessToken,
      // ✅ NUEVO: refresh token para renovar sin re-login
      refreshToken,
      rol: user.rol,
      cargo: user.cargo,
      usuario: user.usuario,
      nombres: user.nombres,
      userId: user.id,
    };
  }

  // ── Logs de acceso (panel admin) ──────────────────────────────────────────
  async getAccessLogs(query: {
    page?: number | string;
    limit?: number | string;
    search?: string;
    estado?: string; // todos | exito | fallido
    rol?: string;
  }) {
    const page = Math.max(1, parseInt(String(query.page || 1), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(query.limit || 20), 10) || 20));

    const qb = this.accessLogRepo.createQueryBuilder('log');

    if (query.search) {
      qb.andWhere('(LOWER(log.identificador) LIKE :s OR LOWER(log.nombres) LIKE :s)', {
        s: `%${query.search.toLowerCase()}%`,
      });
    }
    if (query.estado === 'exito') qb.andWhere('log.exito = :e', { e: true });
    else if (query.estado === 'fallido') qb.andWhere('log.exito = :e', { e: false });
    if (query.rol) qb.andWhere('log.rol = :r', { r: query.rol });

    const [data, total] = await qb
      .orderBy('log.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    // Enriquecer con datos de contacto (correo / celular) para los botones de ayuda
    const userIds = [...new Set(data.map((l) => l.userId).filter(Boolean))] as number[];
    const userMap = new Map<number, User>();
    if (userIds.length) {
      const users = await this.userRepo.find({
        where: { id: In(userIds) },
        select: ['id', 'correo', 'celular'],
      });
      users.forEach((u) => userMap.set(u.id, u));
    }
    const esEmail = (s: string) => /.+@.+\..+/.test(s || '');
    const enriched = data.map((l) => {
      const u = l.userId ? userMap.get(l.userId) : null;
      return {
        ...l,
        correo: u?.correo || (esEmail(l.identificador) ? l.identificador : null),
        celular: u?.celular || null,
      };
    });

    // Resumen rápido para tarjetas
    const totalIntentos = await this.accessLogRepo.count();
    const fallidos = await this.accessLogRepo.count({ where: { exito: false } });

    return {
      data: enriched,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      resumen: { totalIntentos, fallidos, exitosos: totalIntentos - fallidos },
    };
  }

  /**
   * Contacta a un usuario que tuvo problemas de acceso, por correo (envío
   * automático con plantilla de ayuda) o WhatsApp (devuelve un link wa.me con
   * mensaje pre-escrito para que el admin lo envíe).
   */
  async contactAccessLog(id: number, canal: 'email' | 'whatsapp') {
    const log = await this.accessLogRepo.findOne({ where: { id } });
    if (!log) throw new NotFoundException('Registro no encontrado');

    // Resolver el usuario para obtener correo/celular
    let user: User | null = log.userId
      ? await this.userRepo.findOne({ where: { id: log.userId } })
      : null;
    if (!user) {
      user =
        (await this.usersService.findByCorreo(log.identificador)) ||
        (await this.usersService.findByUsuario(log.identificador)) ||
        null;
    }

    const esEmail = (s: string) => /.+@.+\..+/.test(s || '');
    const nombre = (user?.nombres || log.nombres || '').trim() || 'estudiante';
    const correo = user?.correo || (esEmail(log.identificador) ? log.identificador : null);
    const celular = user?.celular || null;
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';

    if (canal === 'whatsapp') {
      if (!celular) {
        throw new BadRequestException('Este usuario no tiene un número de WhatsApp registrado');
      }
      // Enviar por la API de WhatsApp conectada (sesión de Configuración)
      if (!this.whatsappService.getStatus().connected) {
        throw new BadRequestException(
          'WhatsApp no está conectado. Conéctalo en Configuración → WhatsApp e inténtalo de nuevo.',
        );
      }
      const texto =
        `Hola ${nombre}, te escribimos de *MAAT Academy* 👋\n\n` +
        `Notamos que tuviste problemas para ingresar a la plataforma. Queremos ayudarte 🙌\n\n` +
        `¿Cuál fue el inconveniente?\n` +
        `• ¿Olvidaste tu *contraseña*?\n` +
        `• ¿No recuerdas tu *usuario o correo*?\n` +
        `• ¿Tu cuenta aún no está *verificada*?\n\n` +
        `Respóndenos y te ayudamos a recuperar tu acceso. 🔐`;
      try {
        await this.whatsappService.sendText(celular, texto);
      } catch (e: any) {
        throw new BadRequestException(`No se pudo enviar el WhatsApp: ${e.message}`);
      }
      return { success: true, canal, message: `Mensaje de WhatsApp enviado a ${celular}` };
    }

    // canal === 'email'
    if (!correo) {
      throw new BadRequestException('No hay un correo válido para contactar a este usuario');
    }
    const html = `
<div style="font-family:Arial,sans-serif;color:#222;max-width:600px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#2563eb,#7c3aed);padding:20px 24px;border-radius:14px 14px 0 0">
    <h2 style="color:#fff;margin:0">🔐 ¿Tuviste problemas para ingresar?</h2>
  </div>
  <div style="border:1px solid #eee;border-top:none;border-radius:0 0 14px 14px;padding:24px;line-height:1.6">
    <p>Hola <b>${this.escapeHtmlBasic(nombre)}</b>,</p>
    <p>Notamos que tuviste inconvenientes para acceder a <b>MAAT Academy</b> y queremos ayudarte. 🙌</p>
    <p><b>¿Cuál fue el problema?</b></p>
    <ul>
      <li>¿Olvidaste tu <b>contraseña</b>? Restablécela aquí:
        <a href="${frontendUrl}/forgot-password" style="color:#2563eb">Recuperar contraseña</a>.</li>
      <li>¿No recuerdas tu <b>usuario o correo</b>? Responde a este mensaje y te ayudamos.</li>
      <li>¿Tu cuenta aún no está <b>verificada</b>? Avísanos y la activamos por ti.</li>
    </ul>
    <p style="margin-top:16px">Si necesitas asistencia directa, simplemente <b>responde a este correo</b> contándonos qué ocurrió.</p>
    <hr><small>Equipo de soporte · MAAT Academy</small>
  </div>
</div>`.trim();

    await this.mailService.sendMail(correo, '¿Necesitas ayuda para ingresar? — MAAT Academy', html);
    return { success: true, canal, message: `Correo de ayuda enviado a ${correo}` };
  }

  private escapeHtmlBasic(s: string): string {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Refresh Token — genera nuevo accessToken sin re-login ─────────────────

  async refreshAccessToken(refreshToken: string): Promise<{ token: string }> {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token requerido');
    }

    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });

      const newAccessToken = this.signAccessToken(payload.sub, payload.rol);

      return { token: newAccessToken };

    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Sesión expirada. Por favor inicia sesión nuevamente.');
      }
      throw new UnauthorizedException('Token inválido. Por favor inicia sesión nuevamente.');
    }
  }

  // ── Verify Email ──────────────────────────────────────────────────────────

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
      const hoursPassed = (Date.now() - sentTime) / (1000 * 60 * 60);
      if (hoursPassed > 24) {
        throw new BadRequestException(
          'Token de verificación expirado. Por favor solicita un nuevo correo de verificación.',
        );
      }
    }

    user.emailVerified = true;
    user.emailVerificationToken = null;
    await this.usersService.save(user);

    return { message: 'Correo verificado exitosamente. Ahora puedes iniciar sesión.' };
  }

  // ── Resend Verification ───────────────────────────────────────────────────

  async resendVerificationEmail(email: string) {
    const user = await this.usersService.findByCorreo(email);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.emailVerified) throw new BadRequestException('El correo ya ha sido verificado');

    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = verificationToken;
    user.emailVerificationSentAt = new Date();
    await this.usersService.save(user);

    console.log('📧 REENVÍO - Agregando a cola...');
    this.mailQueueService.addToQueue(
      user.correo,
      verificationToken,
      `${user.nombres} ${user.apellidos}`,
    );

    return { message: 'Correo de verificación reenviado. Por favor revisa tu bandeja de entrada.' };
  }

  // ── Verify User Manually (admin) ──────────────────────────────────────────

  async verifyUserManually(userId: number) {
    this.logger.log(`🔧 Verificación manual solicitada para usuario ID: ${userId}`);

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.emailVerified) throw new BadRequestException('El usuario ya está verificado');

    await this.userRepo.update(userId, {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationSentAt: new Date(),
      activo: true,
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
        `,
      );
      this.logger.log(`📧 Notificación enviada a ${user.correo}`);
    } catch (emailError) {
      this.logger.error(`❌ Error enviando notificación a ${user.correo}:`, emailError.message);
    }

    return {
      success: true,
      message: 'Usuario verificado manualmente con éxito',
      user: { id: user.id, nombres: user.nombres, apellidos: user.apellidos, correo: user.correo, emailVerified: true },
    };
  }

  /**
   * Verificación MASIVA. Verifica los usuarios cuyos IDs se reciben (solo los
   * que aún están sin verificar). La actualización en BD es inmediata; las
   * notificaciones por correo se encolan en segundo plano (no bloquean).
   */
  async verifyUsersBulk(ids: number[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException('No se recibieron usuarios para verificar');
    }
    const cleanIds = [...new Set(ids.map((n) => Number(n)).filter((n) => Number.isFinite(n)))];
    const users = await this.userRepo.find({
      where: { id: In(cleanIds), emailVerified: false },
    });

    if (users.length === 0) {
      return { success: true, verified: 0, message: 'No había usuarios pendientes por verificar' };
    }

    await this.userRepo.update(
      { id: In(users.map((u) => u.id)) },
      { emailVerified: true, emailVerificationToken: null, emailVerificationSentAt: new Date(), activo: true },
    );
    this.logger.log(`✅ Verificación masiva: ${users.length} usuario(s) verificados por administrador`);

    // Notificaciones por correo en segundo plano (best-effort, encoladas con anti-baneo).
    for (const user of users) {
      this.mailService
        .sendMail(
          user.correo,
          'Cuenta verificada - Cursos MAAT',
          `
        <div style="font-family: Arial, sans-serif; color:#222;">
          <h2>¡Cuenta verificada exitosamente!</h2>
          <p>Hola <b>${user.nombres}</b>,</p>
          <p>Tu cuenta ha sido verificada por nuestro equipo administrativo. Ya puedes iniciar sesión y acceder a todos los cursos.</p>
          <p>¡Bienvenido a Cursos MAAT!</p>
          <hr><small>Sistema de Cursos MAAT</small>
        </div>`,
        )
        .catch((e) => this.logger.warn(`No se pudo notificar a ${user.correo}: ${e.message}`));
    }

    return {
      success: true,
      verified: users.length,
      message: `${users.length} usuario(s) verificados con éxito`,
    };
  }

  // ── Request Password Reset ────────────────────────────────────────────────

  async requestPasswordReset(correo: string) {
    const user = await this.usersService.findByCorreo(correo);

    if (!user) {
      return { success: true, message: 'Si el correo está registrado, recibirás las instrucciones en breve.' };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.userRepo.update(user.id, {
      passwordResetToken: resetToken,
      passwordResetExpiresAt: expiresAt,
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    await this.mailService.sendMail(
      user.correo,
      '🔐 Restablecer contraseña - Cursos MAAT',
      `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <h2 style="color:#2563eb;margin-bottom:20px">🔐 Restablecer tu contraseña</h2>
  <p>Hola <strong>${user.nombres}</strong>,</p>
  <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
  <div style="text-align:center;margin:30px 0">
    <a href="${resetUrl}" style="background:#2563eb;color:white;padding:14px 32px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold;font-size:16px">
      Restablecer contraseña
    </a>
  </div>
  <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:12px;margin:20px 0">
    <p style="margin:0;color:#92400e;font-size:14px">⚠️ Este enlace expira en <strong>1 hora</strong>.</p>
  </div>
  <p style="color:#6b7280;font-size:13px">Si el botón no funciona: ${resetUrl}</p>
  <hr style="margin:25px 0">
  <p style="color:#9ca3af;font-size:12px">Cursos MAAT</p>
</div>`.trim(),
    );

    this.logger.log(`📧 Correo de recuperación enviado a ${user.correo}`);
    return { success: true, message: 'Si el correo está registrado, recibirás las instrucciones en breve.' };
  }

  // ── Reset Password ────────────────────────────────────────────────────────

  async resetPassword(token: string, newPassword: string) {
    if (!token || !newPassword) {
      throw new BadRequestException('Token y nueva contraseña son requeridos');
    }
    if (newPassword.length < 6) {
      throw new BadRequestException('La contraseña debe tener al menos 6 caracteres');
    }

    const user = await this.userRepo.findOne({ where: { passwordResetToken: token } });
    if (!user) throw new BadRequestException('Token inválido o ya utilizado');

    if (!user.passwordResetExpiresAt || new Date() > user.passwordResetExpiresAt) {
      throw new BadRequestException('El enlace ha expirado. Por favor solicita uno nuevo.');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.userRepo.update(user.id, {
      password: hashedPassword,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
    });

    this.logger.log(`✅ Contraseña restablecida para ${user.correo}`);

    try {
      await this.mailService.sendMail(
        user.correo,
        '✅ Contraseña actualizada - Cursos MAAT',
        `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <h2 style="color:#16a34a">✅ Contraseña actualizada</h2>
  <p>Hola <strong>${user.nombres}</strong>,</p>
  <p>Tu contraseña ha sido restablecida exitosamente. Ya puedes iniciar sesión.</p>
  <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px;margin:20px 0">
    <p style="margin:0;color:#166534;font-size:14px">🔒 Si no realizaste este cambio, contacta a soporte.</p>
  </div>
  <hr style="margin:25px 0">
  <p style="color:#9ca3af;font-size:12px">Cursos MAAT</p>
</div>`.trim(),
      );
    } catch (emailError) {
      this.logger.error(`❌ Error enviando confirmación a ${user.correo}:`, emailError.message);
    }

    return { success: true, message: 'Contraseña restablecida exitosamente. Ya puedes iniciar sesión.' };
  }
}