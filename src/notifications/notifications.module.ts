import { Module } from '@nestjs/common';
import { NotificationsSseService } from './notifications.sse.service';
import { NotificationsSseController } from './notifications.sse.controller';

@Module({
  imports: [],
  controllers: [NotificationsSseController],      // ✅ el controller va aquí
  providers: [NotificationsSseService],           // ✅ el service es provider
  exports: [NotificationsSseService],             // ✅ exporta el service
})
export class NotificationsModule {}
