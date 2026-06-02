import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join } from 'path';

import { Course } from './course.entity';
import { CourseResource } from './course-resource.entity';
import { StudentCourse } from './student-course.entity';
import { PaymentAttempt } from '../payments/payment-attempt.entity';
import { User } from '../users/user.entity';
import { CoursesService } from './courses.service';
import { CoursesController } from './courses.controller';
import { UsersModule } from '../users/users.module';
import { CommonModule } from '../common/common.module';
import { NotificationsModule } from '../notifications/notifications.module';
// ✅ Importar módulo de cupones
import { CouponsModule } from '../coupons/coupons.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Course, CourseResource, StudentCourse, PaymentAttempt, User]),
    UsersModule,
    CommonModule,
    NotificationsModule,
    // ✅ Agregar módulo de cupones
    CouponsModule,
    MulterModule.register({
      storage: diskStorage({
        destination: join(__dirname, '..', '..', 'uploads'),
        filename: (req, file, cb) => {
          const uniqueName = Date.now() + '-' + file.originalname.replace(/\s/g, '_');
          cb(null, uniqueName);
        },
      }),
    }),
  ],
  providers: [CoursesService],
  controllers: [CoursesController],
  exports: [CoursesService, TypeOrmModule],
})
export class CoursesModule {}