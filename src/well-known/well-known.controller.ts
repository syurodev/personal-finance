import { Controller, Get, Header } from '@nestjs/common';
import { auth } from '../auth/auth.js';
import { getEnv } from '../config/env.js';
import { protectedResourceMetadata } from './protected-resource.js';

@Controller('.well-known')
export class WellKnownController {
  @Get(['oauth-protected-resource/mcp', 'oauth-protected-resource'])
  @Header('Cache-Control', 'public, max-age=300')
  protectedResource() {
    return protectedResourceMetadata(getEnv().BASE_URL);
  }

  // Issuer có path `/api/auth` nên vị trí chuẩn RFC 8414 là `/.well-known/oauth-authorization-server/api/auth`.
  // Bản không có hậu tố phục vụ client cũ chỉ thử ở root.
  @Get(['oauth-authorization-server/api/auth', 'oauth-authorization-server'])
  @Header('Cache-Control', 'public, max-age=300')
  authorizationServer() {
    return auth.api.getOAuthServerConfig();
  }
}
