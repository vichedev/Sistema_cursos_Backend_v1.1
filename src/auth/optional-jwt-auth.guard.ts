// src/auth/optional-jwt-auth.guard.ts
import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Autenticación OPCIONAL para endpoints públicos que muestran más datos a
 * usuarios con sesión (p. ej. GET /courses/all: el admin ve también los cursos
 * privados). Nunca bloquea: sin token, o con token inválido/expirado,
 * `req.user` queda en null y el endpoint responde como público.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(_err: any, user: any) {
    return user || null;
  }
}
