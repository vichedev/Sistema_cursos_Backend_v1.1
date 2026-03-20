// src/diplomas/diplomas.controller.ts
import {
    Controller, Get, Post, Param, ParseIntPipe,
    UseGuards, Res, HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { DiplomasService } from './diplomas.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';

@Controller('diplomas')
export class DiplomasController {
    constructor(private readonly diplomasService: DiplomasService) { }

    // ✅ PÚBLICO — descarga directa del PDF por código único
    // GET /api/diplomas/pdf/:codigo
    @Public()
    @Get('pdf/:codigo')
    async descargarPdf(
        @Param('codigo') codigo: string,
        @Res() res: Response,
    ) {
        try {
            const pdfBuffer = await this.diplomasService.generarPdf(codigo);

            // Nombre del archivo sanitizado
            const filename = `Diploma-MAAT-${codigo}.pdf`;

            res.set({
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': pdfBuffer.length,
                'Cache-Control': 'no-store',
            });

            res.status(HttpStatus.OK).end(pdfBuffer);
        } catch (err) {
            res.status(err.status ?? HttpStatus.INTERNAL_SERVER_ERROR).json({
                message: err.message ?? 'Error generando el diploma',
            });
        }
    }

    // ── Endpoints protegidos ADMIN ───────────────────────────────────────────

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
    @Get('cursos')
    getCursosConEstudiantes() {
        return this.diplomasService.getCursosConEstudiantes();
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
    @Get('cursos/:cursoId/estudiantes')
    getEstudiantesDeCurso(@Param('cursoId', ParseIntPipe) cursoId: number) {
        return this.diplomasService.getEstudiantesDeCurso(cursoId);
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
    @Post('enviar/:cursoId/:estudianteId')
    enviarDiploma(
        @Param('cursoId', ParseIntPipe) cursoId: number,
        @Param('estudianteId', ParseIntPipe) estudianteId: number,
    ) {
        return this.diplomasService.enviarDiploma(cursoId, estudianteId);
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('ADMIN')
    @Post('enviar-todos/:cursoId')
    enviarDiplomasTodos(@Param('cursoId', ParseIntPipe) cursoId: number) {
        return this.diplomasService.enviarDiplomasTodos(cursoId);
    }
}