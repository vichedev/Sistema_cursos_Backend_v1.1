import { Controller, Sse, Header } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { merge, interval } from 'rxjs';
import { map } from 'rxjs/operators';
import { NotificationsSseService } from './notifications.sse.service';

@SkipThrottle()
@Controller('notifications')
export class NotificationsSseController {
  constructor(private readonly sse: NotificationsSseService) {}

  @Sse('stream')
  // Evita que nginx/Cloudflare bufferee o comprima el stream (causa de
  // ERR_HTTP2_PROTOCOL_ERROR en conexiones SSE de larga duración).
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('X-Accel-Buffering', 'no')
  stream() {
    // Heartbeat cada 25s para mantener viva la conexión (el front ignora el "ping").
    const heartbeat = interval(25000).pipe(map(() => ({ data: { type: 'ping' } } as MessageEvent)));
    return merge(this.sse.stream, heartbeat);
  }
}
