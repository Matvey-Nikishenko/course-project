import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { lifecycle } from '../lifecycle';

@Controller()
export class ProbesController {
  @Get('healthz')
  healthz() {
    return { status: 'ok', uptime_sec: process.uptime() };
  }

  @Get('readyz')
  readyz() {
    if (!lifecycle.ready) {
      throw new ServiceUnavailableException({
        code: 'not-ready',
        detail: 'the process is draining or has not opened the socket yet',
      });
    }
    return { status: 'ok', uptime_sec: process.uptime() };
  }
}
