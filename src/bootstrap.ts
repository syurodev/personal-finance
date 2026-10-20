import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import type { NextFunction, Request, Response } from 'express';
import { auth } from './auth/auth.js';
import { AUTH_BASE_PATH } from './auth/constants.js';

const httpLogger = new Logger('HTTP');

/** Một dòng log mỗi request. Bỏ query string: nó chứa code/state của OAuth. */
function logRequests(req: Request, res: Response, next: NextFunction): void {
  const startedAt = performance.now();
  res.on('finish', () => {
    const path = req.originalUrl.split('?')[0];
    const ms = Math.round(performance.now() - startedAt);
    httpLogger.log(`${req.method} ${path} ${res.statusCode} ${ms}ms ua="${req.headers['user-agent'] ?? ''}"`);
  });
  next();
}

/**
 * better-auth tự đọc body, nên phải mount trước body parser của Nest.
 * App phải được tạo với `{ bodyParser: false }`.
 */
export function configureApp(app: NestExpressApplication): void {
  const http = app.getHttpAdapter().getInstance();
  http.use(logRequests);
  http.all(`${AUTH_BASE_PATH}/*splat`, toNodeHandler(auth));
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { extended: false });
}
