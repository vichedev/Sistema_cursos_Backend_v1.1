// src/diplomas/diplomas.service.ts
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Course } from '../courses/course.entity';
import { StudentCourse } from '../courses/student-course.entity';
import { User } from '../users/user.entity';
import { MailService } from '../common/mail.service';
import puppeteer from 'puppeteer';

@Injectable()
export class DiplomasService {
  private readonly logger = new Logger(DiplomasService.name);

  constructor(
    @InjectRepository(Course)
    private courseRepo: Repository<Course>,
    @InjectRepository(StudentCourse)
    private studentCourseRepo: Repository<StudentCourse>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private mailService: MailService,
    private config: ConfigService,
  ) { }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private generarCodigo(courseId: number, studentId: number): string {
    const rand = Math.random().toString(36).substring(2, 9).toUpperCase();
    return `MAAT-${courseId.toString().padStart(4, '0')}-${studentId.toString().padStart(6, '0')}-${rand}`;
  }

  private get backendUrl(): string {
    return this.config.get<string>('BACKEND_URL') || 'http://localhost:3000';
  }

  private get frontendUrl(): string {
    return this.config.get<string>('FRONTEND_URL') || 'http://localhost:5173';
  }

  // ── Generar PDF con Puppeteer ─────────────────────────────────────────────
  async generarPdf(codigo: string): Promise<Buffer> {
    // Buscar la inscripción por código
    const inscripcion = await this.studentCourseRepo.findOne({
      where: { diplomaCodigo: codigo },
      relations: ['estudiante', 'curso', 'curso.profesor'],
    });

    if (!inscripcion?.diplomaCodigo) {
      throw new NotFoundException('Diploma no encontrado');
    }

    const html = this.buildDiplomaHtmlForPdf(
      inscripcion.estudiante,
      inscripcion.curso,
      codigo,
      inscripcion.diplomaEmitidoEn ?? new Date(),
    );

    this.logger.log(`📄 Generando PDF para diploma: ${codigo}`);

    // En Alpine/Docker usa el Chromium del sistema; en local usa el bundled de puppeteer
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

    // Args seguros para todos los entornos (Windows/Mac/Linux/Docker)
    const isDocker = !!process.env.PUPPETEER_EXECUTABLE_PATH;
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--no-first-run',
      // --single-process y --no-zygote SOLO en Docker/Alpine, causan crashes en local
      ...(isDocker ? ['--no-zygote', '--single-process'] : []),
    ];

    const browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args,
      // Tiempo generoso para arrancar el browser
      timeout: 30000,
    });

    try {
      const page = await browser.newPage();

      // Timeout amplio para la carga del HTML
      page.setDefaultTimeout(30000);

      // Inyectar las fuentes como base64 en lugar de cargarlas desde Google
      // para evitar problemas de red/timeout en desarrollo local
      const htmlConFuentesInline = html.replace(
        '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet"/>',
        `<style>
          /* Fallback seguro si Google Fonts no carga */
          @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Sans:wght@400;500;600&display=swap');
        </style>`
      );

      // domcontentloaded es más rápido y estable que networkidle0
      await page.setContent(htmlConFuentesInline, { waitUntil: 'domcontentloaded' });

      // Esperar un momento para que carguen las fuentes
      await new Promise(resolve => setTimeout(resolve, 1500));

      const pdf = await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        margin: { top: '12mm', right: '14mm', bottom: '12mm', left: '14mm' },
        // Timeout para la generación del PDF
        timeout: 30000,
      });

      this.logger.log(`✅ PDF generado (${pdf.length} bytes) para: ${codigo}`);
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  // ── Obtener todos los cursos con conteo de estudiantes ────────────────────
  async getCursosConEstudiantes() {
    const courses = await this.courseRepo.find({
      where: { activo: true },
      relations: ['studentCourses', 'studentCourses.estudiante', 'profesor'],
      order: { createdAt: 'DESC' },
    });

    return courses.map((c) => ({
      id: c.id,
      titulo: c.titulo,
      descripcion: c.descripcion,
      imagen: c.imagen,
      tipo: c.tipo,
      fecha: c.fecha,
      hora: c.hora,
      profesor: c.profesor
        ? { nombres: c.profesor.nombres, apellidos: c.profesor.apellidos, asignatura: c.profesor.asignatura }
        : null,
      totalEstudiantes: c.studentCourses?.length ?? 0,
    }));
  }

  // ── Obtener estudiantes de un curso ───────────────────────────────────────
  async getEstudiantesDeCurso(cursoId: number) {
    const course = await this.courseRepo.findOne({
      where: { id: cursoId },
      relations: ['profesor'],
    });
    if (!course) throw new NotFoundException('Curso no encontrado');

    const inscripciones = await this.studentCourseRepo.find({
      where: { cursoId },
      relations: ['estudiante'],
    });

    return {
      curso: {
        id: course.id,
        titulo: course.titulo,
        fecha: course.fecha,
        tipo: course.tipo,
        profesor: course.profesor
          ? { nombres: course.profesor.nombres, apellidos: course.profesor.apellidos, asignatura: course.profesor.asignatura }
          : null,
      },
      estudiantes: inscripciones.map((i) => ({
        estudianteId: i.estudiante.id,
        nombres: i.estudiante.nombres,
        apellidos: i.estudiante.apellidos,
        correo: i.estudiante.correo,
        cedula: i.estudiante.cedula,
        diplomaEnviado: !!i.diplomaCodigo,
        diplomaEmitidoEn: i.diplomaEmitidoEn,
      })),
    };
  }

  // ── Enviar diploma a un estudiante ────────────────────────────────────────
  async enviarDiploma(
    cursoId: number,
    estudianteId: number,
  ): Promise<{ success: boolean; message: string; codigo: string }> {
    const course = await this.courseRepo.findOne({
      where: { id: cursoId },
      relations: ['profesor'],
    });
    if (!course) throw new NotFoundException('Curso no encontrado');

    const student = await this.userRepo.findOne({ where: { id: estudianteId } });
    if (!student) throw new NotFoundException('Estudiante no encontrado');

    const inscripcion = await this.studentCourseRepo.findOne({
      where: { cursoId, estudianteId },
    });
    if (!inscripcion) throw new BadRequestException('El estudiante no está inscrito en este curso');

    // Reutilizar código si ya existe, o crear uno nuevo
    const codigo = inscripcion.diplomaCodigo || this.generarCodigo(cursoId, estudianteId);

    // URL directa de descarga PDF
    const urlPdf = `${this.backendUrl}/api/diplomas/pdf/${codigo}`;

    // Persistir
    await this.studentCourseRepo.update(inscripcion.id, {
      diplomaCodigo: codigo,
      diplomaEmitidoEn: new Date(),
    });

    const emailHtml = this.buildEmailHtml(student, course, codigo, urlPdf);
    await this.mailService.sendDiploma(student.correo, course.titulo, emailHtml, student.nombres);

    return { success: true, message: `Diploma enviado a ${student.correo}`, codigo };
  }

  // ── Enviar diplomas a TODOS (por lotes para no saturar el SMTP) ─────────
  async enviarDiplomasTodos(
    cursoId: number,
  ): Promise<{ success: boolean; enviados: number; errores: number; detalle: any[] }> {

    // ── Configuración de lotes ─────────────────────────────────────────────
    // Ajusta estos valores según los límites de tu servidor SMTP de cPanel:
    const LOTE_TAMANO = 3;      // correos por lote
    const PAUSA_MS = 8000;   // 8 segundos entre lotes
    const PAUSA_ENTRE = 1500;   // 1.5s entre cada correo dentro del lote

    const course = await this.courseRepo.findOne({
      where: { id: cursoId },
      relations: ['profesor'],
    });
    if (!course) throw new NotFoundException('Curso no encontrado');

    const inscripciones = await this.studentCourseRepo.find({
      where: { cursoId },
      relations: ['estudiante'],
    });

    if (inscripciones.length === 0) {
      throw new BadRequestException('No hay estudiantes inscritos en este curso');
    }

    let enviados = 0;
    let errores = 0;
    const detalle: any[] = [];

    // ── Dividir en lotes ───────────────────────────────────────────────────
    const lotes: typeof inscripciones[] = [];
    for (let i = 0; i < inscripciones.length; i += LOTE_TAMANO) {
      lotes.push(inscripciones.slice(i, i + LOTE_TAMANO));
    }

    this.logger.log(
      `📦 Enviando diplomas en ${lotes.length} lote(s) de ${LOTE_TAMANO} ` +
      `| Total: ${inscripciones.length} | Pausa: ${PAUSA_MS / 1000}s entre lotes`
    );

    for (let loteIdx = 0; loteIdx < lotes.length; loteIdx++) {
      const lote = lotes[loteIdx];

      this.logger.log(`📬 Procesando lote ${loteIdx + 1}/${lotes.length} (${lote.length} diplomas)`);

      for (let i = 0; i < lote.length; i++) {
        const inscripcion = lote[i];
        const student = inscripcion.estudiante;

        try {
          const codigo = inscripcion.diplomaCodigo || this.generarCodigo(cursoId, student.id);
          const urlPdf = `${this.backendUrl}/api/diplomas/pdf/${codigo}`;

          await this.studentCourseRepo.update(inscripcion.id, {
            diplomaCodigo: codigo,
            diplomaEmitidoEn: new Date(),
          });

          const emailHtml = this.buildEmailHtml(student, course, codigo, urlPdf);
          await this.mailService.sendDiploma(student.correo, course.titulo, emailHtml, student.nombres);

          enviados++;
          detalle.push({
            correo: student.correo,
            nombre: `${student.nombres} ${student.apellidos}`,
            status: 'enviado',
            codigo,
            lote: loteIdx + 1,
          });

          this.logger.log(`✅ [Lote ${loteIdx + 1}] Diploma enviado a ${student.correo}`);

        } catch (err) {
          this.logger.warn(`⚠️  [Lote ${loteIdx + 1}] Error con ${student.correo}: ${err.message}`);
          errores++;
          detalle.push({
            correo: student.correo,
            nombre: `${student.nombres} ${student.apellidos}`,
            status: 'error',
            lote: loteIdx + 1,
          });
        }

        // Pausa entre correos dentro del mismo lote (excepto el último del lote)
        if (i < lote.length - 1) {
          await new Promise(r => setTimeout(r, PAUSA_ENTRE));
        }
      }

      // Pausa entre lotes (excepto después del último lote)
      if (loteIdx < lotes.length - 1) {
        this.logger.log(
          `⏳ Pausa de ${PAUSA_MS / 1000}s antes del lote ${loteIdx + 2}... ` +
          `(enviados: ${enviados}, errores: ${errores})`
        );
        await new Promise(r => setTimeout(r, PAUSA_MS));
      }
    }

    this.logger.log(`🎓 Proceso completado | Enviados: ${enviados} | Errores: ${errores}`);
    return { success: true, enviados, errores, detalle };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HTML DEL CORREO — contiene el diploma visual + botón de descarga directa
  // ─────────────────────────────────────────────────────────────────────────
  private buildEmailHtml(student: User, course: Course, codigo: string, urlPdf: string): string {
    const nombreCompleto = `${student.nombres} ${student.apellidos}`;
    const profesorNombre = course.profesor
      ? `${course.profesor.nombres} ${course.profesor.apellidos}`
      : 'MAAT Academy';
    const profesorAsignatura = course.profesor?.asignatura ?? '';
    const fechaEmision = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    const fechaCurso = course.fecha
      ? new Date(course.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
      : fechaEmision;
    const logoUrl = `${this.frontendUrl}/logo_render.png`;

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Diploma – ${course.titulo}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet"/>
</head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'DM Sans',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 16px;">
<tr><td align="center">

  <!-- BLOQUE DESCARGA DIRECTA -->
  <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;margin-bottom:16px;">
    <tr>
      <td align="center" style="padding:20px 28px;background:#ffffff;border-radius:14px;border:1px solid #dbeafe;box-shadow:0 2px 10px rgba(37,99,235,0.08);">
        <p style="margin:0 0 14px;font-size:15px;color:#0f172a;font-family:'DM Sans',Arial,sans-serif;font-weight:600;">
          🎓 ¡Hola ${student.nombres}! Tu diploma está listo.
        </p>
        <p style="margin:0 0 18px;font-size:13px;color:#64748b;font-family:'DM Sans',Arial,sans-serif;line-height:1.5;">
          Haz clic en el botón para descargar tu diploma en formato PDF directamente a tu dispositivo.
        </p>
        <!-- BOTÓN DESCARGA DIRECTA PDF -->
        <a href="${urlPdf}"
           download="Diploma-MAAT-${student.nombres.replace(/\s+/g, '-')}.pdf"
           style="
             display:inline-block;
             background:linear-gradient(135deg,#1d4ed8,#2563eb);
             color:#ffffff !important;
             text-decoration:none;
             font-family:'DM Sans',Arial,sans-serif;
             font-size:16px;
             font-weight:700;
             padding:15px 40px;
             border-radius:10px;
             letter-spacing:0.3px;
             box-shadow:0 4px 16px rgba(37,99,235,0.4);
           ">
          ⬇️ Descargar Diploma PDF
        </a>
        <p style="margin:14px 0 0;font-size:11px;color:#94a3b8;font-family:'DM Sans',Arial,sans-serif;">
          Si el botón no funciona, copia este enlace en tu navegador:<br/>
          <a href="${urlPdf}" style="color:#2563eb;word-break:break-all;">${urlPdf}</a>
        </p>
      </td>
    </tr>
  </table>

  <!-- DIPLOMA VISUAL (vista previa en el correo) -->
  <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 20px 60px rgba(37,99,235,0.12);border:1px solid #dbeafe;">

    <!-- Franja azul superior -->
    <tr>
      <td style="background:linear-gradient(135deg,#1d4ed8 0%,#2563eb 50%,#0ea5e9 100%);padding:40px 48px 32px;text-align:center;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td align="center" style="padding-bottom:18px;">
            <img src="${logoUrl}" alt="MAAT Academy" width="110" style="display:block;height:auto;border-radius:9px;background:#fff;padding:7px;" onerror="this.style.display='none'"/>
          </td>
        </tr></table>
        <p style="margin:0 0 5px;font-size:11px;letter-spacing:5px;color:#bfdbfe;font-family:'DM Sans',Arial,sans-serif;font-weight:700;text-transform:uppercase;">MAAT ACADEMY</p>
        <h1 style="margin:0;font-size:27px;color:#ffffff;font-family:'Playfair Display',Georgia,serif;font-weight:700;letter-spacing:0.5px;line-height:1.2;">Diploma de Asistencia</h1>
        <table width="80" cellpadding="0" cellspacing="0" style="margin:14px auto 0;"><tr><td style="height:2px;background:linear-gradient(90deg,transparent,#93c5fd,transparent);"></td></tr></table>
      </td>
    </tr>

    <!-- Cuerpo blanco -->
    <tr>
      <td style="padding:40px 48px 34px;text-align:center;background:#ffffff;">
        <p style="margin:0 0 8px;font-size:11px;color:#64748b;letter-spacing:3px;text-transform:uppercase;font-family:'DM Sans',Arial,sans-serif;font-weight:600;">Este diploma se otorga a</p>
        <h2 style="margin:0 0 6px;font-size:34px;color:#0f172a;font-family:'Playfair Display',Georgia,serif;font-weight:700;line-height:1.2;">${nombreCompleto}</h2>
        <table width="190" cellpadding="0" cellspacing="0" style="margin:0 auto 22px;"><tr><td style="height:2px;background:linear-gradient(90deg,transparent,#2563eb,transparent);"></td></tr></table>
        <p style="margin:0 0 5px;font-size:14px;color:#64748b;font-family:'DM Sans',Arial,sans-serif;">por su participación y asistencia en el curso</p>
        <div style="margin:15px auto 30px;max-width:460px;background:linear-gradient(135deg,#eff6ff,#f0f9ff);border:1.5px solid #bfdbfe;border-radius:12px;padding:15px 24px;">
          <h3 style="margin:0;font-size:19px;color:#1d4ed8;font-family:'Playfair Display',Georgia,serif;font-weight:700;line-height:1.4;">${course.titulo}</h3>
        </div>

        <!-- Fechas -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
          <tr>
            <td width="50%" style="padding:0 7px 0 0;">
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:13px 15px;text-align:center;">
                <p style="margin:0 0 3px;font-size:10px;color:#94a3b8;letter-spacing:2px;text-transform:uppercase;font-family:'DM Sans',Arial,sans-serif;font-weight:600;">Fecha del curso</p>
                <p style="margin:0;font-size:14px;color:#0f172a;font-family:'DM Sans',Arial,sans-serif;font-weight:600;">${fechaCurso}</p>
              </div>
            </td>
            <td width="50%" style="padding:0 0 0 7px;">
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:13px 15px;text-align:center;">
                <p style="margin:0 0 3px;font-size:10px;color:#94a3b8;letter-spacing:2px;text-transform:uppercase;font-family:'DM Sans',Arial,sans-serif;font-weight:600;">Fecha de emisión</p>
                <p style="margin:0;font-size:14px;color:#0f172a;font-family:'DM Sans',Arial,sans-serif;font-weight:600;">${fechaEmision}</p>
              </div>
            </td>
          </tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:26px;"><tr><td style="height:1px;background:#e2e8f0;"></td></tr></table>

        <!-- Firma -->
        <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
          <table width="170" cellpadding="0" cellspacing="0" style="margin:0 auto 8px;"><tr><td style="height:1.5px;background:#cbd5e1;border-radius:1px;"></td></tr></table>
          <p style="margin:0 0 2px;font-size:15px;color:#0f172a;font-family:'Playfair Display',Georgia,serif;font-weight:700;">${profesorNombre}</p>
          ${profesorAsignatura ? `<p style="margin:0 0 3px;font-size:12px;color:#64748b;font-family:'DM Sans',Arial,sans-serif;">${profesorAsignatura}</p>` : ''}
          <p style="margin:0;font-size:10px;color:#2563eb;font-family:'DM Sans',Arial,sans-serif;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Instructor · MAAT Academy</p>
        </td></tr></table>
      </td>
    </tr>

    <!-- Código único -->
    <tr>
      <td style="background:linear-gradient(135deg,#eff6ff,#f0f9ff);padding:13px 48px;border-top:1px solid #dbeafe;text-align:center;">
        <p style="margin:0;font-size:10px;color:#94a3b8;font-family:'Courier New',monospace;letter-spacing:1.5px;">${codigo}</p>
      </td>
    </tr>
  </table>

  <!-- Pie correo -->
  <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;margin-top:18px;">
    <tr><td align="center">
      <p style="margin:0;font-size:12px;color:#94a3b8;font-family:'DM Sans',Arial,sans-serif;line-height:1.6;">
        Emitido por <strong style="color:#64748b;">MAAT Academy</strong> · Este correo fue generado automáticamente, no respondas a este mensaje.
      </p>
    </td></tr>
  </table>

</td></tr>
</table>
</body>
</html>`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HTML LIMPIO PARA PUPPETEER — optimizado para impresión A4 landscape
  // ─────────────────────────────────────────────────────────────────────────
  private buildDiplomaHtmlForPdf(
    student: User,
    course: Course,
    codigo: string,
    emitidoEn: Date,
  ): string {
    const nombreCompleto = `${student.nombres} ${student.apellidos}`;
    const profesorNombre = course.profesor
      ? `${course.profesor.nombres} ${course.profesor.apellidos}`
      : 'MAAT Academy';
    const profesorAsignatura = course.profesor?.asignatura ?? '';
    const fechaEmision = emitidoEn.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    const fechaCurso = course.fecha
      ? new Date(course.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
      : fechaEmision;
    const logoUrl = `${this.frontendUrl}/logo_render.png`;

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  html, body { width:100%; height:100%; background:#f0f4f8; font-family:'DM Sans',Arial,sans-serif; }

  .page {
    width: 277mm;
    min-height: 190mm;
    margin: 0 auto;
    background: #ffffff;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 8px 40px rgba(37,99,235,0.15);
    display: flex;
    flex-direction: column;
  }

  /* Franja azul superior */
  .header {
    background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 50%, #0ea5e9 100%);
    padding: 28px 56px 24px;
    text-align: center;
  }
  .header img { height: 60px; border-radius: 8px; background: #fff; padding: 6px; margin-bottom: 14px; }
  .header .institution { font-size: 10px; letter-spacing: 5px; color: #bfdbfe; font-weight: 700; text-transform: uppercase; margin-bottom: 4px; }
  .header h1 { font-size: 26px; color: #ffffff; font-family: 'Playfair Display', Georgia, serif; font-weight: 700; line-height: 1.2; }
  .header .line { width: 70px; height: 2px; background: linear-gradient(90deg, transparent, #93c5fd, transparent); margin: 12px auto 0; border-radius: 1px; }

  /* Cuerpo */
  .body { padding: 28px 56px 24px; text-align: center; flex: 1; }
  .label-small { font-size: 10px; color: #64748b; letter-spacing: 3px; text-transform: uppercase; font-weight: 600; margin-bottom: 7px; }
  .student-name { font-size: 34px; color: #0f172a; font-family: 'Playfair Display', Georgia, serif; font-weight: 700; line-height: 1.2; margin-bottom: 5px; }
  .name-line { width: 180px; height: 2px; background: linear-gradient(90deg, transparent, #2563eb, transparent); margin: 0 auto 18px; border-radius: 1px; }
  .subtitle { font-size: 13px; color: #64748b; margin-bottom: 5px; }

  .course-box {
    max-width: 440px;
    margin: 12px auto 22px;
    background: linear-gradient(135deg, #eff6ff, #f0f9ff);
    border: 1.5px solid #bfdbfe;
    border-radius: 10px;
    padding: 13px 22px;
  }
  .course-box h3 { font-size: 18px; color: #1d4ed8; font-family: 'Playfair Display', Georgia, serif; font-weight: 700; line-height: 1.4; }

  .dates { display: flex; gap: 12px; justify-content: center; margin-bottom: 22px; }
  .date-card { flex: 1; max-width: 190px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 9px; padding: 11px 14px; }
  .date-card .date-label { font-size: 9px; color: #94a3b8; letter-spacing: 2px; text-transform: uppercase; font-weight: 600; margin-bottom: 3px; }
  .date-card .date-value { font-size: 13px; color: #0f172a; font-weight: 600; }

  .divider { height: 1px; background: #e2e8f0; margin-bottom: 18px; }

  .signature { text-align: center; }
  .sig-line { width: 160px; height: 1.5px; background: #cbd5e1; margin: 0 auto 7px; border-radius: 1px; }
  .sig-name { font-size: 15px; color: #0f172a; font-family: 'Playfair Display', Georgia, serif; font-weight: 700; margin-bottom: 2px; }
  .sig-subject { font-size: 11px; color: #64748b; margin-bottom: 3px; }
  .sig-role { font-size: 10px; color: #2563eb; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }

  /* Footer código */
  .footer {
    background: linear-gradient(135deg, #eff6ff, #f0f9ff);
    padding: 11px 56px;
    border-top: 1px solid #dbeafe;
    text-align: center;
  }
  .footer p { font-size: 9px; color: #94a3b8; font-family: 'Courier New', monospace; letter-spacing: 1.5px; }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <img src="${logoUrl}" alt="MAAT Academy" onerror="this.style.display='none'"/>
    <p class="institution">MAAT ACADEMY</p>
    <h1>Diploma de Asistencia</h1>
    <div class="line"></div>
  </div>

  <div class="body">
    <p class="label-small">Este diploma se otorga a</p>
    <h2 class="student-name">${nombreCompleto}</h2>
    <div class="name-line"></div>

    <p class="subtitle">por su participación y asistencia en el curso</p>
    <div class="course-box">
      <h3>${course.titulo}</h3>
    </div>

    <div class="dates">
      <div class="date-card">
        <p class="date-label">Fecha del curso</p>
        <p class="date-value">${fechaCurso}</p>
      </div>
      <div class="date-card">
        <p class="date-label">Fecha de emisión</p>
        <p class="date-value">${fechaEmision}</p>
      </div>
    </div>

    <div class="divider"></div>

    <div class="signature">
      <div class="sig-line"></div>
      <p class="sig-name">${profesorNombre}</p>
      ${profesorAsignatura ? `<p class="sig-subject">${profesorAsignatura}</p>` : ''}
      <p class="sig-role">Instructor · MAAT Academy</p>
    </div>
  </div>

  <div class="footer">
    <p>${codigo}</p>
  </div>

</div>
</body>
</html>`;
  }
}