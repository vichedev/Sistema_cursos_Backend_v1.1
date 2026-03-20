// src/auth/auth.controller.ts
import {
  Controller, Post, Body, UseGuards, Get,
  Query, BadRequestException, Request,
  UsePipes, ValidationPipe, Param,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { Public } from './public.decorator';

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

  // ✅ NUEVO — Renovar access token usando el refresh token
  // Endpoint público, no requiere JWT (el access token ya expiró)
  @Public()
  @Post('refresh')
  async refresh(@Body('refreshToken') refreshToken: string) {
    if (!refreshToken) {
      throw new BadRequestException('refreshToken es requerido');
    }
    return this.authService.refreshAccessToken(refreshToken);
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