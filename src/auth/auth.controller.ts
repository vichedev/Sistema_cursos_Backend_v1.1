import { Controller, Post, Body, UseGuards, Get, Query, BadRequestException, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // Ruta GET para verificar correo electrónico
  @Get('verify-email')
  async verifyEmail(@Query('token') token: string) {
    if (!token) {
      throw new BadRequestException('Token de verificación requerido');
    }
    return this.authService.verifyEmail(token);
  }

  // Ruta POST para reenviar correo de verificación
  @Post('resend-verification')
  async resendVerification(@Body('email') email: string) {
    if (!email) {
      throw new BadRequestException('Email es requerido');
    }
    return this.authService.resendVerificationEmail(email);
  }

  // Ruta protegida solo para ADMIN
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('usuarios')
  findAll(@Request() req) {
    return 'Sólo para admins';
  }
}