import { OAUTH_SCOPES, authIssuer, mcpResourceUrl } from '../auth/constants.js';

/** RFC 9728 metadata cho resource `/mcp`. `offline_access` để client xin refresh token. */
export function protectedResourceMetadata(baseUrl: string) {
  return {
    resource: mcpResourceUrl(baseUrl),
    authorization_servers: [authIssuer(baseUrl)],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Personal Finance',
  };
}
