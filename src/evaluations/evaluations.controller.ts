// src/evaluations/evaluations.controller.ts
// Rutas del ESTUDIANTE: /api/evaluaciones/...
// Cualquier usuario autenticado; el acceso real (inscrito / asignado) y la
// propiedad del intento se validan en el servicio. El userId sale SIEMPRE del token.
import {
  Body, Controller, Get, Param, ParseIntPipe, Post, Put, Request, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EvaluationsService } from './evaluations.service';
import { GuardarRespuestaDto } from './dto/evaluaciones.dto';

@Controller('evaluaciones')
@UseGuards(JwtAuthGuard)
export class EvaluationsController {
  constructor(private readonly evaluations: EvaluationsService) {}

  @Get('mis-diagnosticos')
  async misDiagnosticos(@Request() req) {
    return { success: true, data: await this.evaluations.misDiagnosticos(Number(req.user.userId)) };
  }

  @Get('intentos/:intentoId')
  async obtenerIntento(@Param('intentoId', ParseIntPipe) intentoId: number, @Request() req) {
    return this.evaluations.obtenerIntento(Number(req.user.userId), intentoId);
  }

  @Put('intentos/:intentoId/respuestas')
  async guardarRespuesta(
    @Param('intentoId', ParseIntPipe) intentoId: number,
    @Body() dto: GuardarRespuestaDto,
    @Request() req,
  ) {
    return this.evaluations.guardarRespuesta(Number(req.user.userId), intentoId, dto);
  }

  @Post('intentos/:intentoId/enviar')
  async enviar(@Param('intentoId', ParseIntPipe) intentoId: number, @Request() req) {
    return this.evaluations.enviar(Number(req.user.userId), intentoId);
  }

  @Post(':id/iniciar')
  async iniciar(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.evaluations.iniciar(Number(req.user.userId), id);
  }
}
