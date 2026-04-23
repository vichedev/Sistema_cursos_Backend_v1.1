// src/auth/auth.controller.ts
import {
  Controller, Post, Body, UseGuards, Get,
  Query, BadRequestException, Request, Req,
  UsePipes, ValidationPipe, Param, Res,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
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
  constructor(private authService: AuthService) { }

  @Post('register')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const data = await this.authService.login(dto);
    // VULN-02: Establecer refreshToken como cookie httpOnly para protegerlo de XSS
    res.cookie(REFRESH_TOKEN_COOKIE, data.refreshToken, COOKIE_OPTIONS);
    return data;
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