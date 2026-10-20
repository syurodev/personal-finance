import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth/auth.js';
import { AUTH_BASE_PATH } from './auth/constants.js';

/**
 * better-auth tự đọc body, nên phải mount trước body parser của Nest.
 * App phải được tạo với `{ bodyParser: false }`.
 */
export function configureApp(app: NestExpressApplication): void {
  const http = app.getHttpAdapter().getInstance();
  http.all(`${AUTH_BASE_PATH}/*splat`, toNodeHandler(auth));
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { extended: false });
}
