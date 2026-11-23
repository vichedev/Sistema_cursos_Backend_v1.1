// src/auth/roles.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    // SEGURIDAD: leer @Roles tanto del método como de la clase. Antes solo se
    // leía del método, por lo que un @Roles('ADMIN') a nivel de controlador
    // (settings, campaigns, whatsapp) se ignoraba y cualquier usuario
    // autenticado podía usar esos endpoints. El del método tiene prioridad.
    const roles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    return !!request.user && roles.includes(request.user.rol);
  }
}
