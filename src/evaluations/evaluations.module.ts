// src/evaluations/evaluations.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/course.entity';
import { StudentCourse } from '../courses/student-course.entity';
import { CourseAssignment } from '../courses/course-assignment.entity';
import { User } from '../users/user.entity';
import { Evaluacion } from './evaluacion.entity';
import { EvaluacionPregunta } from './evaluacion-pregunta.entity';
import { EvaluacionOpcion } from './evaluacion-opcion.entity';
import { EvaluacionIntento } from './evaluacion-intento.entity';
import { EvaluacionRespuesta } from './evaluacion-respuesta.entity';
import { EvaluationsService } from './evaluations.service';
import { EvaluationsAdminService } from './evaluations-admin.service';
import { EvaluationsController } from './evaluations.controller';
import { EvaluationsAdminController } from './evaluations-admin.controller';
import { EvaluationsCron } from './evaluations.cron';

// MailService (CommonModule) y WhatsappService (WhatsappModule) son @Global.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Evaluacion,
      EvaluacionPregunta,
      EvaluacionOpcion,
      EvaluacionIntento,
      EvaluacionRespuesta,
      Course,
      StudentCourse,
      CourseAssignment,
      User,
    ]),
  ],
  providers: [EvaluationsService, EvaluationsAdminService, EvaluationsCron],
  // El controlador de admin va primero: sus rutas 'evaluaciones/admin/...' son
  // más específicas que 'evaluaciones/:id/...'.
  controllers: [EvaluationsAdminController, EvaluationsController],
})
export class EvaluationsModule {}
