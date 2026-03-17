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
  Query,
  BadRequestException,
  Patch // ✅ IMPORT AGREGADO
} from '@nestjs/common';
import { CoursesService } from './courses.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { AIService } from '../common/ai.service';

@Controller('courses')
export class CoursesController {
  constructor(
    private readonly coursesService: CoursesService,
    private readonly aiService: AIService,
  ) { }

  // ✅ ENDPOINT PARA GENERAR DESCRIPCIÓN AUTOMÁTICA CON IA
  // Solo usuarios autenticados pueden usar esta función
  @Get('api/generate-description')
  @UseGuards(JwtAuthGuard)
  async generateDescription(@Query('titulo') titulo: string) {
    try {
      // Validaciones de entrada
      if (!titulo || titulo.trim().length < 3) {
        throw new BadRequestException('El título debe tener al menos 3 caracteres');
      }

      if (titulo.length > 100) {
        throw new BadRequestException('El título es demasiado largo (máximo 100 caracteres)');
      }

      // Generar descripción usando el servicio de IA
      const description = await this.aiService.generateCourseDescription(titulo.trim());

      return {
        success: true,
        data: {
          descripcion: description,
          titulo: titulo
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'No se pudo generar la descripción automática'
      };
    }
  }

  // ✅ CREAR NUEVO CURSO
  // Solo ADMIN puede crear cursos, requiere autenticación JWT y verificación de rol
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post('create')
  @UseInterceptors(FileInterceptor('imagen'))
  async create(
    @Body() body,
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    // Obtener ID del profesor (puede venir del body o del usuario autenticado)
    let profesorId = body.profesorId || req.user.userId;
    let profesorNombre = '';
    let profesorAsignatura = '';

    // Buscar información del profesor si se proporciona ID
    if (profesorId) {
      const user = await this.coursesService.findUserById(Number(profesorId));
      profesorNombre = user ? `${user.nombres} ${user.apellidos}` : '';
      profesorAsignatura = user?.asignatura || '';
    }

    // Crear el curso con los datos proporcionados
    return this.coursesService.create({
      ...body,
      imagen: file ? file.filename : null, // Guardar nombre del archivo si se subió imagen
      profesorId,
      profesorNombre,
      profesorAsignatura,
    });
  }

  // ✅ ACTUALIZAR CURSO EXISTENTE
  // Solo ADMIN puede actualizar cursos, requiere autenticación JWT y verificación de rol
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

    // Convertir campos numéricos a los tipos correctos
    if (body.profesorId) updateData.profesorId = Number(body.profesorId);
    if (body.cupos) updateData.cupos = Number(body.cupos);
    if (body.precio) updateData.precio = parseFloat(body.precio);

    // Solo actualizar la imagen si se proporciona un nuevo archivo
    if (file) {
      updateData.imagen = file.filename;
    }

    return this.coursesService.update(id, updateData);
  }

  // ✅ ELIMINACIÓN LÓGICA DE CURSO
  // Solo ADMIN puede eliminar cursos, requiere autenticación JWT y verificación de rol
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Delete(':id')
  async delete(@Param('id', ParseIntPipe) id: number) {
    return this.coursesService.softDeleteCourse(id); // Eliminación lógica (no física)
  }

  // ✅ OBTENER CURSOS DISPONIBLES PARA INSCRIPCIÓN
  // Solo usuarios autenticados pueden ver cursos disponibles
  @UseGuards(JwtAuthGuard)
  @Get('disponibles')
  async disponibles(@Request() req) {
    const userId = req.user.userId;
    // Retorna cursos con información del estado de inscripción del usuario Y CUPONES
    return this.coursesService.cursosConEstadoInscrito(userId);
  }

  // ✅ OBTENER TODOS LOS CURSOS (ENDPOINT PÚBLICO PERO CON DATOS FILTRADOS)
  // Este endpoint es público pero filtra información sensible
  @Get('all')
  async all() {
    const courses = await this.coursesService.findAll();
    // Filtrar datos sensibles antes de retornar
    return this.filterPublicCourseData(courses);
  }

  // ✅ OBTENER CURSOS DEL USUARIO AUTENTICADO
  // Solo usuarios autenticados pueden ver sus cursos
  @UseGuards(JwtAuthGuard)
  @Get('mis-cursos')
  async misCursos(@Request() req) {
    const userId = req.user.userId;
    return this.coursesService.misCursos(userId);
  }

  // ✅ OBTENER ESTUDIANTES INSCRITOS EN UN CURSO
  // Solo ADMIN puede ver la lista de estudiantes, requiere autenticación JWT y verificación de rol
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':id/estudiantes')
  async estudiantesCurso(@Param('id', ParseIntPipe) id: number) {
    return this.coursesService.estudiantesCurso(id);
  }

  // ✅ OBTENER ESTUDIANTES CON INFORMACIÓN DE PAGOS
  // Solo ADMIN puede ver información de pagos, requiere autenticación JWT y verificación de rol
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':id/estudiantes-con-pagos')
  async estudiantesCursoConPagos(@Param('id', ParseIntPipe) id: number) {
    return this.coursesService.estudiantesCursoConPagos(id);
  }

  // Solo ADMIN puede acceder a detalles completos de cualquier curso
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':id')
  async getById(@Param('id', ParseIntPipe) id: number) {
    return this.coursesService.findById(id);
  }

  private filterPublicCourseData(courses: any[]) {
    return courses.map(course => {
      // ✅ CALCULAR CUPONES DISPONIBLES (solo para saber si hay)
      const cuponesActivos = course.cupones?.filter(cupon =>
        cupon.activo &&
        cupon.usosActuales < cupon.usosMaximos &&
        (!cupon.fechaExpiracion || new Date() < cupon.fechaExpiracion)
      ) || [];

      // Crear objeto filtrado con solo información segura para mostrar públicamente
      const filteredCourse: any = {
        id: course.id,
        titulo: course.titulo,
        descripcion: course.descripcion,
        imagen: course.imagen,
        tipo: course.tipo,
        cupos: course.cupos,
        // ❌ link y recursosLink OMITIDOS — solo visibles tras inscripción/compra
        precio: course.precio,
        createdAt: course.createdAt,
        updatedAt: course.updatedAt,
        fecha: course.fecha,
        hora: course.hora,
        activo: course.activo,
        // ✅ SOLO INDICAR SI HAY CUPONES, SIN CONTADOR
        tieneCupones: cuponesActivos.length > 0
      };

      // Filtrar información del profesor - solo datos públicos
      if (course.profesor) {
        filteredCourse.profesor = {
          id: course.profesor.id,
          nombres: course.profesor.nombres,
          apellidos: course.profesor.apellidos,
          asignatura: course.profesor.asignatura
        };
      }

      return filteredCourse;
    });
  }


  // ✅ OBTENER CURSOS INACTIVOS (ELIMINADOS/ARCHIVADOS)
  // Solo ADMIN puede ver cursos inactivos
  // En el método getCursosInactivos
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('admin/inactivos')
  async getCursosInactivos() {

    try {
      const courses = await this.coursesService.findInactiveCourses();
      const filtered = this.filterPublicCourseData(courses);
      return filtered;
    } catch (error) {
      throw error;
    }
  }

  // ✅ OBTENER TODOS LOS CURSOS (ACTIVOS E INACTIVOS) PARA ADMIN
  // Solo ADMIN puede ver todos los cursos sin filtrar
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('admin/todos')
  async getAllCoursesForAdmin() {
    const courses = await this.coursesService.findAllForAdmin();
    // Filtrar datos sensibles antes de retornar
    return this.filterPublicCourseData(courses);
  }

  // ✅ ACTIVAR CURSO (RESTAURAR)
  // Solo ADMIN puede restaurar cursos
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Patch(':id/activate')
  async activateCourse(@Param('id', ParseIntPipe) id: number) {
    return this.coursesService.activateCourse(id);
  }

  // ✅ DESACTIVAR CURSO (ARCHIVAR/ELIMINAR LÓGICAMENTE)
  // Solo ADMIN puede archivar cursos
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Patch(':id/deactivate')
  async deactivateCourse(@Param('id', ParseIntPipe) id: number) {
    return this.coursesService.softDeleteCourse(id);
  }

  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Delete(':id/permanent')
  async deleteCoursePermanently(@Param('id', ParseIntPipe) id: number) {
    return this.coursesService.deleteCoursePermanently(id);
  }



}