import { Controller, Sse } from '@nestjs/common';
import { map } from 'rxjs/operators';
import { NotificationsSseService } from './notifications.sse.service';

@Controller('notifications')
export class NotificationsSseController {
  constructor(private readonly sse: NotificationsSseService) {}

  @Sse('stream')
  stream() {
    // opcional: puedes mapear para añadir event/type si quieres
    return this.sse.stream.pipe(map((msg) => msg));
  }
}
