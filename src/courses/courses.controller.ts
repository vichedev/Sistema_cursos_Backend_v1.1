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
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { AIService } from '../common/ai.service';
import { SkipThrottle } from '@nestjs/throttler';
import { isDateOnlyExpired } from '../common/date.util';
import { ensureValidImage, imageFileFilter } from '../common/upload.util';
import { AsignarEstudiantesDto, NotificarAsignadosDto } from './dto/asignaciones.dto';

// VULN-09: validación por magic bytes y nombres seguros → common/upload.util.ts
const imageUploadOptions = {
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: imageFileFilter,
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
    ensureValidImage(file);

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
      categoriaId: body.categoriaId ? Number(body.categoriaId) : null,
      precio: Math.round(parseFloat(body.precio || 0) * 100) / 100,
      // Curso privado: multipart lo envía como "true"/"false"
      privado: body.privado === true || body.privado === 'true',
    });
  }

  /** Reenvía las notificaciones de "nuevo curso" a los estudiantes (correo/WhatsApp). */
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post(':id/notificar')
  async reenviarNotificaciones(@Param('id', ParseIntPipe) id: number, @Body() body) {
    const correo = body?.notificarCorreo === true || body?.notificarCorreo === 'true';
    const whatsapp = body?.notificarWhatsapp === true || body?.notificarWhatsapp === 'true';
    return this.coursesService.reenviarNotificaciones(id, correo, whatsapp);
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
    ensureValidImage(file);

    const updateData: any = { ...body };

    if (body.profesorId) updateData.profesorId = Number(body.profesorId);
    if (body.cupos) updateData.cupos = Number(body.cupos);
    if (body.precio) updateData.precio = parseFloat(body.precio);
    // categoriaId: "" o "null" => quitar categoría; número => asignar
    if (body.categoriaId !== undefined) {
      updateData.categoriaId =
        body.categoriaId === '' || body.categoriaId === 'null' || body.categoriaId === null
          ? null
          : Number(body.categoriaId);
    }

    // privado: multipart lo envía como "true"/"false"; si no viene, no se toca
    if (body.privado !== undefined) {
      updateData.privado = body.privado === true || body.privado === 'true';
    }

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
  // Público (landing): nunca incluye cursos privados. Si quien consulta es un
  // ADMIN con sesión válida, incluye también los privados (las pantallas del
  // panel admin — Todos los cursos, Material, Publicidad, Cupones, Dashboard —
  // usan este endpoint).
  @SkipThrottle()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('all')
  async all(@Request() req) {
    const esAdmin = req.user?.rol === 'ADMIN';
    const courses = await this.coursesService.findAll({ incluirPrivados: esAdmin });
    const data = this.filterPublicCourseData(courses);
    return esAdmin ? this.conAsignados(data) : data;
  }

  /** Panel admin: añade `totalAsignados` a los cursos privados. */
  private async conAsignados(cursos: any[]) {
    const ids = cursos.filter((c) => c.privado).map((c) => c.id);
    const mapa = await this.coursesService.contarAsignados(ids);
    return cursos.map((c) => (c.privado ? { ...c, totalAsignados: mapa.get(c.id) || 0 } : c));
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
        !isDateOnlyExpired(cupon.fechaExpiracion)
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
        zonaHoraria: course.zonaHoraria || 'America/Guayaquil',
        activo: course.activo,
        finalizado: course.finalizado ?? false,
        categoriaId: course.categoriaId ?? null,
        privado: course.privado ?? false,
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
      return { ...result, data: await this.conAsignados(this.filterPublicCourseData(result.data)) };
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
    return { ...result, data: await this.conAsignados(this.filterPublicCourseData(result.data)) };
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

  /** Marca/desmarca el curso como finalizado (manual, por el admin). */
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Patch(':id/finalizar')
  async finalizarCurso(
    @Param('id', ParseIntPipe) id: number,
    @Body('finalizado') finalizado: boolean,
  ) {
    return this.coursesService.setFinalizado(id, finalizado !== false);
  }

  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Delete(':id/permanent')
  async deleteCoursePermanently(@Param('id', ParseIntPipe) id: number) {
    return this.coursesService.deleteCoursePermanently(id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  CURSOS PRIVADOS — ESTUDIANTES ASIGNADOS (solo ADMIN)
  // ───────────────────────────────────────────────────────────────────────────

  /** Estudiantes asignados al curso (con estado de inscripción/pago). */
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':id/asignados')
  async listarAsignados(@Param('id', ParseIntPipe) id: number) {
    return { success: true, data: await this.coursesService.listarAsignados(id) };
  }

  /** Búsqueda de estudiantes que aún no están asignados al curso (máx. 20). */
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':id/asignables')
  async buscarAsignables(@Param('id', ParseIntPipe) id: number, @Query('q') q?: string) {
    return { success: true, data: await this.coursesService.buscarAsignables(id, q) };
  }

  /** Reenvía el aviso (correo/WhatsApp) a todos los asignados. Envío en segundo plano. */
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post(':id/asignados/notificar')
  async notificarAsignados(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: NotificarAsignadosDto,
  ) {
    return this.coursesService.notificarAsignados(id, body.correo === true, body.whatsapp === true);
  }

  /** Asigna estudiantes a un curso privado (si es gratis, además los inscribe). */
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post(':id/asignados')
  async asignarEstudiantes(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AsignarEstudiantesDto,
    @Request() req,
  ) {
    return this.coursesService.asignarEstudiantes(
      id,
      body.estudianteIds,
      Number(req.user?.userId) || null,
      body.notificarCorreo === true,
      body.notificarWhatsapp === true,
    );
  }

  /** Quita a un estudiante de un curso privado. */
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Delete(':id/asignados/:estudianteId')
  async quitarAsignado(
    @Param('id', ParseIntPipe) id: number,
    @Param('estudianteId', ParseIntPipe) estudianteId: number,
  ) {
    return this.coursesService.quitarAsignado(id, estudianteId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  MATERIAL DIDÁCTICO (RECURSOS DEL CURSO)
  // ───────────────────────────────────────────────────────────────────────────

  /** Lista los materiales de un curso. */
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':id/resources')
  async listResources(@Param('id', ParseIntPipe) id: number) {
    return { success: true, data: await this.coursesService.listResources(id) };
  }

  /** Asocia un enlace de material (MEGA, Google Drive, Dropbox, etc.) al curso. */
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post(':id/resources')
  async addResource(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { titulo?: string; url?: string },
  ) {
    return { success: true, data: await this.coursesService.addResourceLink(id, body?.titulo || '', body?.url || '') };
  }

  /** Elimina un material del curso. */
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Delete(':id/resources/:resourceId')
  async deleteResource(
    @Param('id', ParseIntPipe) id: number,
    @Param('resourceId', ParseIntPipe) resourceId: number,
  ) {
    return this.coursesService.deleteResource(id, resourceId);
  }

  /** Envía el material seleccionado a los estudiantes inscritos elegidos. */
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post(':id/resources/send')
  async sendResources(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.coursesService.sendResources(id, body);
  }

  /** Progreso en vivo de un envío de material (anti-baneo). */
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get(':id/resources/send-status/:jobId')
  async sendStatus(@Param('jobId') jobId: string) {
    return { success: true, ...this.coursesService.getResourceSendStatus(jobId) };
  }
}