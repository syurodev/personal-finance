export const FINANCE_READ = 'finance:read';
export const FINANCE_WRITE = 'finance:write';
export const OFFLINE_ACCESS = 'offline_access';

export const OAUTH_SCOPES = [OFFLINE_ACCESS, FINANCE_READ, FINANCE_WRITE];

export const AUTH_BASE_PATH = '/api/auth';

export function mcpResourceUrl(baseUrl: string): string {
  return `${baseUrl}/mcp`;
}

export function authIssuer(baseUrl: string): string {
  return `${baseUrl}${AUTH_BASE_PATH}`;
}
