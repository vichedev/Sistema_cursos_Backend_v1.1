// src/stats/stats.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StatsService } from './stats.service';
import { StatsController } from './stats.controller';

import { User } from '../users/user.entity';
import { Course } from '../courses/course.entity';
import { StudentCourse } from '../courses/student-course.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Course, StudentCourse]),
  ],
  providers: [StatsService],
  controllers: [StatsController],
  exports: [StatsService],
})
export class StatsModule {}
