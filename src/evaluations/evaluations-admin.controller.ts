// src/evaluations/evaluations-admin.controller.ts
// Rutas de ADMIN: /api/evaluaciones/admin/...
import {
  Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Request, UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { EvaluationsAdminService } from './evaluations-admin.service';
import {
  ActualizarEvaluacionDto, CrearEvaluacionDto, GuardarPreguntasDto, PublicarEvaluacionDto,
} from './dto/evaluaciones.dto';

// SEGURIDAD: todo el controlador es solo ADMIN (RolesGuard lee @Roles de la clase).
@Controller('evaluaciones/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class EvaluationsAdminController {
  constructor(private readonly admin: EvaluationsAdminService) {}

  /** Id entero positivo recibido por query (mismo criterio que ParseIntPipe). */
  private idDeQuery(valor: unknown, nombre: string, obligatorio: boolean): number | undefined {
    if (valor === undefined || valor === null || String(valor).trim() === '') {
      if (obligatorio) throw new BadRequestException(`${nombre} es obligatorio`);
      return undefined;
    }
    if (typeof valor !== 'string' || !/^\d+$/.test(valor.trim())) {
      throw new BadRequestException(`${nombre} no válido`);
    }
    const n = Number(valor.trim());
    if (!Number.isSafeInteger(n) || n < 1 || n > 2147483647) {
      throw new BadRequestException(`${nombre} no válido`);
    }
    return n;
  }

  @Get()
  async listar(@Query('cursoId') cursoId?: string) {
    let id: number | undefined;
    if (cursoId !== undefined && cursoId !== null && String(cursoId).trim() !== '') {
      id = Number(cursoId);
      if (!Number.isInteger(id) || id < 1) throw new BadRequestException('cursoId no válido');
    }
    return { success: true, data: await this.admin.listar(id) };
  }

  @Post()
  async crear(@Body() dto: CrearEvaluacionDto, @Request() req) {
    return { success: true, data: await this.admin.crear(dto, Number(req.user?.userId) || null) };
  }

  // ⚠️ Antes de las rutas ':id' para que "comparativa" no se interprete como id.
  @Get('comparativa')
  async comparativa(
    @Query('cursoId') cursoId?: string,
    @Query('diagnosticoId') diagnosticoId?: string,
    @Query('finalId') finalId?: string,
  ) {
    const curso = this.idDeQuery(cursoId, 'cursoId', true) as number;
    const diag = this.idDeQuery(diagnosticoId, 'diagnosticoId', false);
    const fin = this.idDeQuery(finalId, 'finalId', false);
    return { success: true, data: await this.admin.comparativa(curso, diag, fin) };
  }

  // ⚠️ Antes de las rutas ':id' para que "intentos" no se interprete como id.
  @Get('intentos/:intentoId')
  async detalleIntento(@Param('intentoId', ParseIntPipe) intentoId: number) {
    return { success: true, data: await this.admin.detalleIntento(intentoId) };
  }

  @Get(':id/resultados')
  async resultados(@Param('id', ParseIntPipe) id: number) {
    return { success: true, data: await this.admin.resultados(id) };
  }

  @Get(':id')
  async obtener(@Param('id', ParseIntPipe) id: number) {
    return { success: true, data: await this.admin.completa(id) };
  }

  @Put(':id/preguntas')
  async guardarPreguntas(@Param('id', ParseIntPipe) id: number, @Body() dto: GuardarPreguntasDto) {
    return { success: true, data: await this.admin.guardarPreguntas(id, dto) };
  }

  @Put(':id')
  async actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarEvaluacionDto) {
    return { success: true, data: await this.admin.actualizar(id, dto) };
  }

  @Post(':id/publicar')
  async publicar(@Param('id', ParseIntPipe) id: number, @Body() dto: PublicarEvaluacionDto) {
    return {
      success: true,
      data: await this.admin.publicar(id, dto?.notificarCorreo === true, dto?.notificarWhatsapp === true),
    };
  }

  @Post(':id/cerrar')
  async cerrar(@Param('id', ParseIntPipe) id: number) {
    return { success: true, data: await this.admin.cerrar(id) };
  }

  @Post(':id/reabrir')
  async reabrir(@Param('id', ParseIntPipe) id: number) {
    return { success: true, data: await this.admin.reabrir(id) };
  }

  @Post(':id/duplicar')
  async duplicar(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return { success: true, data: await this.admin.duplicar(id, Number(req.user?.userId) || null) };
  }

  @Delete(':id')
  async eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.admin.eliminar(id);
  }
}
