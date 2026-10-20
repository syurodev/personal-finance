import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { getEnv } from '../src/config/env.js';

export async function startApp(): Promise<{ app: NestExpressApplication; baseUrl: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  await app.listen(getEnv().PORT);
  return { app, baseUrl: getEnv().BASE_URL };
}
