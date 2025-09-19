// src/courses/courses.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join } from 'path';

import { Course } from './course.entity';
import { StudentCourse } from './student-course.entity';
import { PaymentAttempt } from '../payments/payment-attempt.entity';
import { User } from '../users/user.entity';
import { CoursesService } from './courses.service';
import { CoursesController } from './courses.controller';
import { UsersModule } from '../users/users.module';
import { CommonModule } from '../common/common.module';
// ⬇️ IMPORTA el módulo de notificaciones (debe exportar el service)
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Course, StudentCourse, PaymentAttempt, User]),
    UsersModule,
    CommonModule,
    NotificationsModule,                // ⬅️ AQUI EL IMPORT FALTANTE
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
