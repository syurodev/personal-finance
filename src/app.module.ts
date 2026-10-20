import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health.controller.js';
import { McpAuthService } from './mcp/mcp-auth.service.js';
import { McpController } from './mcp/mcp.controller.js';
import { PagesController } from './pages/pages.controller.js';
import { WellKnownController } from './well-known/well-known.controller.js';

@Module({
  imports: [DbModule],
  controllers: [HealthController, WellKnownController, PagesController, McpController],
  providers: [McpAuthService],
})
export class AppModule {}
