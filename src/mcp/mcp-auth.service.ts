import { getOAuthProviderApi } from '@better-auth/oauth-provider';
import { Injectable } from '@nestjs/common';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { auth, oauthProviderPlugin } from '../auth/auth.js';
import { mcpResourceUrl } from '../auth/constants.js';
import { getEnv } from '../config/env.js';

export class InvalidAccessTokenError extends Error {}

type ProviderCtx = Parameters<typeof getOAuthProviderApi>[0];
type ProviderOpts = Parameters<typeof getOAuthProviderApi>[1];

function isUnauthorized(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { statusCode, status } = error as { statusCode?: unknown; status?: unknown };
  return statusCode === 401 || status === 'UNAUTHORIZED';
}

@Injectable()
export class McpAuthService {
  /** Xác thực `Authorization: Bearer <opaque token>` do oauth-provider cấp. */
  async verify(authorization: string | undefined): Promise<AuthInfo> {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
    if (!match?.[1]) throw new InvalidAccessTokenError('Missing bearer token');
    const token = match[1];

    // Đường kiểm tra token opaque chỉ dùng ctx.context.{adapter, internalAdapter, baseURL}.
    const context = await auth.$context;
    const provider = getOAuthProviderApi(
      { context } as unknown as ProviderCtx,
      oauthProviderPlugin.options as unknown as ProviderOpts,
    );

    let payload: Awaited<ReturnType<typeof provider.requireActiveAccessToken>>;
    try {
      payload = await provider.requireActiveAccessToken(token);
    } catch (error) {
      if (isUnauthorized(error)) throw new InvalidAccessTokenError('Inactive access token');
      throw error;
    }

    // Server chỉ có một resource; token không mang `aud` (client không gửi `resource`) vẫn được chấp nhận.
    const audience = payload.aud === undefined ? [] : Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (audience.length > 0 && !audience.includes(mcpResourceUrl(getEnv().BASE_URL))) {
      throw new InvalidAccessTokenError('Token was not issued for this resource');
    }
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw new InvalidAccessTokenError('Token has no subject');
    }

    return {
      token,
      clientId: typeof payload.client_id === 'string' ? payload.client_id : '',
      scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [],
      expiresAt: typeof payload.exp === 'number' ? payload.exp : undefined,
      extra: { userId: payload.sub },
    };
  }
}
