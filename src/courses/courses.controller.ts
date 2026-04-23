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
  Patch
} from '@nestjs/common';
import { CoursesService } from './courses.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { AIService } from '../common/ai.service';
import { SkipThrottle } from '@nestjs/throttler';

// VULN-09: Validación por magic bytes — no confiar solo en extensión
function validateImageMimeType(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 4) return false;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return true;
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return true;
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return true;
  // GIF: 47 49 46 38
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return true;
  return false;
}

const imageUploadOptions = {
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req: any, file: Express.Multer.File, cb: any) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedMimes.includes(file.mimetype)) {
      return cb(new BadRequestException('Solo se permiten imágenes JPEG, PNG, WebP o GIF'), false);
    }
    cb(null, true);
  },
};

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
  @UseInterceptors(FileInterceptor('imagen', imageUploadOptions))
  async create(
    @Body() body,
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    // VULN-09: Validar magic bytes del archivo subido
    if (file && !validateImageMimeType(file.buffer)) {
      throw new BadRequestException('El archivo no es una imagen válida');
    }

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
      precio: Math.round(parseFloat(body.precio || 0) * 100) / 100,
    });
  }

  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Put(':id')
  @UseInterceptors(FileInterceptor('imagen', imageUploadOptions))
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body,
    @UploadedFile() file: Express.Multer.File,
  ) {
    // VULN-09: Validar magic bytes del archivo subido
    if (file && !validateImageMimeType(file.buffer)) {
      throw new BadRequestException('El archivo no es una imagen válida');
    }

    const updateData: any = { ...body };

    if (body.profesorId) updateData.profesorId = Number(body.profesorId);
    if (body.cupos) updateData.cupos = Number(body.cupos);
    if (body.precio) updateData.precio = parseFloat(body.precio);

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
  @SkipThrottle()
  @UseGuards(JwtAuthGuard)
  @Get('disponibles')
  async disponibles(@Request() req) {
    const userId = req.user.userId;
    return this.coursesService.cursosConEstadoInscrito(userId);
  }

  // ✅ OBTENER TODOS LOS CURSOS (ENDPOINT PÚBLICO CON DATOS FILTRADOS)
  @SkipThrottle()
  @Get('all')
  async all() {
    const courses = await this.coursesService.findAll();
    return this.filterPublicCourseData(courses);
  }

  // ✅ OBTENER CURSOS DEL USUARIO AUTENTICADO
  @SkipThrottle()
  @UseGuards(JwtAuthGuard)
  @Get('mis-cursos')
  async misCursos(@Request() req) {
    const userId = req.user.userId;
    return this.coursesService.misCursos(userId);
  }

  // ✅ OBTENER ESTUDIANTES INSCRITOS EN UN CURSO
  @SkipThrottle()
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':id/estudiantes')
  async estudiantesCurso(@Param('id', ParseIntPipe) id: number) {
    return this.coursesService.estudiantesCurso(id);
  }

  // ✅ OBTENER ESTUDIANTES CON INFORMACIÓN DE PAGOS
  @SkipThrottle()
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
  async getCursosInactivos(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('search') search = '',
  ) {
    try {
      const result = await this.coursesService.findInactiveCourses(+page, +limit, search);
      return { ...result, data: this.filterPublicCourseData(result.data) };
    } catch (error) {
      throw error;
    }
  }

  // MEJ-03: Paginación con búsqueda — ?page=1&limit=20&search=nombre
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('admin/todos')
  async getAllCoursesForAdmin(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('search') search = '',
  ) {
    const result = await this.coursesService.findAllForAdmin(+page, +limit, search);
    return { ...result, data: this.filterPublicCourseData(result.data) };
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