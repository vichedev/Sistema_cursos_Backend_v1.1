import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join } from 'path';

import { Course } from './course.entity';
import { StudentCourse } from './student-course.entity';
import { CoursesService } from './courses.service';
import { CoursesController } from './courses.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Course, StudentCourse]),
    UsersModule,
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
  exports: [CoursesService, TypeOrmModule], // exporta TypeOrmModule para compartir entidades
})
export class CoursesModule {}
