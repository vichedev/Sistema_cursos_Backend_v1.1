// src/diplomas/diplomas.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DiplomasController } from './diplomas.controller';
import { DiplomasService } from './diplomas.service';
import { Course } from '../courses/course.entity';
import { StudentCourse } from '../courses/student-course.entity';
import { User } from '../users/user.entity';
import { CommonModule } from '../common/common.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Course, StudentCourse, User]),
        CommonModule,
    ],
    controllers: [DiplomasController],
    providers: [DiplomasService],
})
export class DiplomasModule { }