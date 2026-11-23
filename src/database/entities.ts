// src/database/entities.ts
// Lista única de entidades: la usan AppModule y el DataSource de la CLI de
// migraciones, para que nunca se desincronicen.
import { User } from '../users/user.entity';
import { Course } from '../courses/course.entity';
import { CourseResource } from '../courses/course-resource.entity';
import { Category } from '../categories/category.entity';
import { AccessLog } from '../auth/access-log.entity';
import { StudentCourse } from '../courses/student-course.entity';
import { PaymentAttempt } from '../payments/payment-attempt.entity';
import { Coupon } from '../coupons/coupon.entity';
import { CouponUsage } from '../coupons/coupon-usage.entity';
import { Setting } from '../settings/setting.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { CampaignRecipient } from '../campaigns/campaign-recipient.entity';
import { CourseAssignment } from '../courses/course-assignment.entity';
import { Evaluacion } from '../evaluations/evaluacion.entity';
import { EvaluacionPregunta } from '../evaluations/evaluacion-pregunta.entity';
import { EvaluacionOpcion } from '../evaluations/evaluacion-opcion.entity';
import { EvaluacionIntento } from '../evaluations/evaluacion-intento.entity';
import { EvaluacionRespuesta } from '../evaluations/evaluacion-respuesta.entity';

export const ENTITIES = [
  User,
  Course,
  CourseResource,
  Category,
  AccessLog,
  StudentCourse,
  PaymentAttempt,
  Coupon,
  CouponUsage,
  Setting,
  Campaign,
  CampaignRecipient,
  CourseAssignment,
  Evaluacion,
  EvaluacionPregunta,
  EvaluacionOpcion,
  EvaluacionIntento,
  EvaluacionRespuesta,
];
