import { Controller, Sse } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { map } from 'rxjs/operators';
import { NotificationsSseService } from './notifications.sse.service';

@SkipThrottle()
@Controller('notifications')
export class NotificationsSseController {
  constructor(private readonly sse: NotificationsSseService) {}

  @Sse('stream')
  stream() {
    return this.sse.stream.pipe(map((msg) => msg));
  }
}
