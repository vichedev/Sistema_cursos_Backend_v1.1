// src/campaigns/campaigns.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { join } from 'path';

import { Campaign } from './campaign.entity';
import { CampaignRecipient } from './campaign-recipient.entity';
import { User } from '../users/user.entity';
import { StudentCourse } from '../courses/student-course.entity';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Campaign, CampaignRecipient, User, StudentCourse]),
    MulterModule.register({
      storage: diskStorage({
        destination: join(__dirname, '..', '..', 'uploads'),
        filename: (_req, file, cb) => {
          const uniqueName = Date.now() + '-' + file.originalname.replace(/\s/g, '_');
          cb(null, uniqueName);
        },
      }),
    }),
  ],
  providers: [CampaignsService],
  controllers: [CampaignsController],
  exports: [CampaignsService],
})
export class CampaignsModule {}
