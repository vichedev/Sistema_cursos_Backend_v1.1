import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  UploadedFile,
  UseInterceptors,
  Request,
  Param,
  Delete,
  Put,
  ParseIntPipe,
} from '@nestjs/common';
import { CoursesService } from './courses.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) { }

  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post('create')
  @UseInterceptors(FileInterceptor('imagen'))
  async create(
    @Body() body,
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    let profesorId = body.profesorId || req.user.userId;
    let profesorNombre = '';
    let profesorAsignatura = '';

    if (profesorId) {
      const user = await this.coursesService.findUserById(Number(profesorId));
      profesorNombre = user ? `${user.nombres} ${user.apellidos}` : '';
      profesorAsignatura = user?.asignatura || '';
    }

    return this.coursesService.create({
      ...body,
      imagen: file ? file.filename : null,
      profesorId,
      profesorNombre,
      profesorAsignatura,
    });
  }

  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Put(':id')
  @UseInterceptors(FileInterceptor('imagen'))
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const updateData: any = { ...body };

    // Convertir campos numéricos
    if (body.profesorId) updateData.profesorId = Number(body.profesorId);
    if (body.cupos) updateData.cupos = Number(body.cupos);
    if (body.precio) updateData.precio = parseFloat(body.precio);

    // Solo actualizar la imagen si se proporciona un nuevo archivo
    if (file) {
      updateData.imagen = file.filename;
    }

    return this.coursesService.update(id, updateData);
  }

  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Delete(':id')
  async delete(@Param('id', ParseIntPipe) id: number) {
    return this.coursesService.softDeleteCourse(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('disponibles')
  async disponibles(@Request() req) {
    const userId = req.user.userId;
    return this.coursesService.cursosConEstadoInscrito(userId);
  }

  @Get('all')
  async all() {
    return this.coursesService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Get('mis-cursos')
  async misCursos(@Request() req) {
    const userId = req.user.userId;
    return this.coursesService.misCursos(userId);
  }

  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':id/estudiantes')
  async estudiantesCurso(@Param('id', ParseIntPipe) id: number) {
    return this.coursesService.estudiantesCurso(id);
  }


  // En tu courses.controller.ts
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':id/estudiantes-con-pagos')
  async estudiantesCursoConPagos(@Param('id', ParseIntPipe) id: number) {
    return this.coursesService.estudiantesCursoConPagos(id);
  }

  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':id')
  async getById(@Param('id', ParseIntPipe) id: number) {
    return this.coursesService.findById(id);
  }
}