// src/auth/auth.controller.ts
import {
  Controller, Post, Body, UseGuards, Get,
  Query, BadRequestException, Request, Req,
  UsePipes, ValidationPipe, Param, Res,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { EmailValidatorService } from '../common/email-validator.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { Public } from './public.decorator';

const REFRESH_TOKEN_COOKIE = 'refreshToken';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private emailValidator: EmailValidatorService,
  ) { }

  /** PÚBLICO: validación en vivo del correo en el formulario de registro. */
  @Public()
  @Post('check-email')
  async checkEmail(@Body('correo') correo: string) {
    const data = await this.emailValidator.validate(correo || '', { smtp: false });
    return { success: true, data };
  }

  @Post('register')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async login(@Body() dto: LoginDto, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    const ip =
      (req.headers?.['x-forwarded-for'] || '').toString().split(',')[0].trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      null;
    const userAgent = (req.headers?.['user-agent'] || '').toString().slice(0, 255) || null;

    const data = await this.authService.login(dto, { ip, userAgent });
    // VULN-02: Establecer refreshToken como cookie httpOnly para protegerlo de XSS
    res.cookie(REFRESH_TOKEN_COOKIE, data.refreshToken, COOKIE_OPTIONS);
    return data;
  }

  /** Logs de acceso para el panel admin (monitoreo de ingresos y problemas). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('access-logs')
  async getAccessLogs(@Query() query: any) {
    return { success: true, ...(await this.authService.getAccessLogs(query)) };
  }

  /** Contacta a un usuario con problemas de acceso (correo automático o link de WhatsApp). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('access-logs/:id/contact')
  async contactAccessLog(@Param('id') id: number, @Body('canal') canal: 'email' | 'whatsapp') {
    if (canal !== 'email' && canal !== 'whatsapp') {
      throw new BadRequestException('Canal inválido');
    }
    return this.authService.contactAccessLog(Number(id), canal);
  }

  // Renovar access token usando el refresh token desde cookie httpOnly (o body como fallback)
  @Public()
  @Post('refresh')
  async refresh(
    @Req() req: any,
    @Body('refreshToken') refreshTokenBody: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE] || refreshTokenBody;
    if (!refreshToken) {
      throw new BadRequestException('refreshToken es requerido');
    }
    const data = await this.authService.refreshAccessToken(refreshToken);
    // Renovar también la cookie
    res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, COOKIE_OPTIONS);
    return data;
  }

  @Public()
  @Post('logout')
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/' });
    return { success: true, message: 'Sesión cerrada' };
  }

  @Get('verify-email')
  async verifyEmail(@Query('token') token: string) {
    if (!token) throw new BadRequestException('Token de verificación requerido');
    return this.authService.verifyEmail(token);
  }

  @Post('resend-verification')
  async resendVerification(@Body('email') email: string) {
    if (!email) throw new BadRequestException('Email es requerido');
    return this.authService.resendVerificationEmail(email);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('admin/verify-user/:userId')
  async verifyUserManually(@Param('userId') userId: number) {
    if (!userId) throw new BadRequestException('ID de usuario requerido');
    return this.authService.verifyUserManually(userId);
  }

  /** Verificación masiva de usuarios (por lista de IDs). */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('admin/verify-users')
  async verifyUsersBulk(@Body('ids') ids: number[]) {
    return this.authService.verifyUsersBulk(ids);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('usuarios')
  findAll(@Request() req) {
    return 'Sólo para admins';
  }

  @Post('forgot-password')
  async forgotPassword(@Body('correo') correo: string) {
    if (!correo) throw new BadRequestException('El correo es requerido');
    return this.authService.requestPasswordReset(correo);
  }

  @Post('reset-password')
  async resetPassword(
    @Body('token') token: string,
    @Body('newPassword') newPassword: string,
  ) {
    if (!token || !newPassword) {
      throw new BadRequestException('Token y nueva contraseña son requeridos');
    }
    return this.authService.resetPassword(token, newPassword);
  }
}