import { oauthProvider } from '@better-auth/oauth-provider';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { getEnv } from '../config/env.js';
import { db } from '../db/index.js';
import * as authSchema from '../db/schema/auth.js';
import { isEmailAllowed } from './allowlist.js';
import { AUTH_BASE_PATH, OAUTH_SCOPES, mcpResourceUrl } from './constants.js';

const env = getEnv();
const mcpResource = mcpResourceUrl(env.BASE_URL);

export const oauthProviderPlugin = oauthProvider({
  loginPage: '/login',
  consentPage: '/consent',
  scopes: OAUTH_SCOPES,
  // Token opaque: revoke có hiệu lực ngay, không cần JWKS.
  disableJwtPlugin: true,
  // Claude/ChatGPT tự đăng ký client công khai (PKCE) khi connect.
  allowDynamicClientRegistration: true,
  allowUnauthenticatedClientRegistration: true,
  clientRegistrationDefaultApplicationType: 'infer',
  resources: [{ identifier: mcpResource, name: 'Personal Finance MCP' }],
  clientRegistrationDefaultResources: [mcpResource],
  accessTokenExpiresIn: 60 * 60,
  refreshTokenExpiresIn: 60 * 60 * 24 * 90,
  // Claude/ChatGPT gọi từ IP dùng chung: nới giới hạn mặc định (register 5/phút, token 20/phút).
  rateLimit: {
    register: { window: 60, max: 30 },
    token: { window: 60, max: 120 },
  },
});

export const auth = betterAuth({
  baseURL: env.BASE_URL,
  basePath: AUTH_BASE_PATH,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      baseCurrency: { type: 'string', required: false, defaultValue: 'VND', input: false },
      timezone: { type: 'string', required: false, defaultValue: 'Asia/Ho_Chi_Minh', input: false },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-up/email') return;
      const email = typeof ctx.body?.email === 'string' ? ctx.body.email : '';
      if (!isEmailAllowed(email, env.allowedEmails)) {
        throw new APIError('FORBIDDEN', { message: 'Email này không được phép tạo tài khoản.' });
      }
    }),
  },
  plugins: [oauthProviderPlugin],
});
