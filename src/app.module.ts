import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health.controller.js';
import { WellKnownController } from './well-known/well-known.controller.js';

@Module({
  imports: [DbModule],
  controllers: [HealthController, WellKnownController],
})
export class AppModule {}
