import { Controller, Post, Body, UseGuards, Get, Query, BadRequestException, Request, UsePipes, ValidationPipe, Param } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) { }

  @Post('register')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('verify-email')
  async verifyEmail(@Query('token') token: string) {
    if (!token) {
      throw new BadRequestException('Token de verificación requerido');
    }
    return this.authService.verifyEmail(token);
  }

  @Post('resend-verification')
  async resendVerification(@Body('email') email: string) {
    if (!email) {
      throw new BadRequestException('Email es requerido');
    }
    return this.authService.resendVerificationEmail(email);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('admin/verify-user/:userId')
  async verifyUserManually(@Param('userId') userId: number) {
    if (!userId) {
      throw new BadRequestException('ID de usuario requerido');
    }
    return this.authService.verifyUserManually(userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('usuarios')
  findAll(@Request() req) {
    return 'Sólo para admins';
  }

  // ================================================================
  // ✅ PASO 1 — Solicitar restablecimiento de contraseña
  // El estudiante ingresa su correo y recibe un link por email
  // Endpoint público (no requiere JWT)
  // ================================================================
  @Post('forgot-password')
  async forgotPassword(@Body('correo') correo: string) {
    if (!correo) {
      throw new BadRequestException('El correo es requerido');
    }
    return this.authService.requestPasswordReset(correo);
  }

  // ================================================================
  // ✅ PASO 2 — Establecer nueva contraseña con el token del email
  // El token llega como query param desde el link del correo
  // Endpoint público (no requiere JWT)
  // ================================================================
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