import { Controller, Get, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { StatsService } from './stats.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@SkipThrottle()
@Controller('stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(private statsService: StatsService) {}

  @Get('general')
  async getGeneralStats() {
    return this.statsService.getGeneralStats();
  }
}
