import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';

@Controller('healthz')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }

  // Chỉ để kiểm tra body parser của Nest vẫn hoạt động sau khi mount better-auth.
  @Post('echo')
  @HttpCode(200)
  echo(@Body() body: unknown): unknown {
    return body;
  }
}
