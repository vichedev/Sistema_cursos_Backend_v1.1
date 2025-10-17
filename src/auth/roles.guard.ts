// src/auth/roles.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator'; // ✅ IMPORTAR

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // ✅ VERIFICAR SI ES ENDPOINT PÚBLICO
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true; // ✅ PERMITIR ACCESO SIN AUTENTICACIÓN
    }

    const roles = this.reflector.get<string[]>('roles', context.getHandler());
    if (!roles) return true;
    
    const request = context.switchToHttp().getRequest();
    return roles.includes(request.user.rol);
  }
}