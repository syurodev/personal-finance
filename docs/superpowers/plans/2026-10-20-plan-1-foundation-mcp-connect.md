# Plan 1 — Nền tảng & kết nối MCP: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một app NestJS chạy trên Bun mà Claude/ChatGPT connect được qua OAuth 2.1 (DCR + PKCE), gọi được tool MCP `whoami`, với mọi request MCP chạy trong transaction Postgres có Row Level Security theo user.

**Architecture:** Modular monolith. better-auth (email/password + `@better-auth/oauth-provider`, access token opaque) mount ở `/api/auth/*` trước body parser của Nest. `POST /mcp` tự xác thực bearer token bằng `getOAuthProviderApi(...).requireActiveAccessToken`, mở transaction và `set_config('app.user_id', …, true)`, rồi giao request cho một `McpServer` + `StreamableHTTPServerTransport` stateless tạo mới mỗi request. Domain code lấy transaction từ `AsyncLocalStorage`.

**Tech Stack:** Bun 1.4, NestJS 12 (platform-express, Express 5), better-auth 1.7.11, @better-auth/oauth-provider 1.7.11, Drizzle ORM 0.45 + node-postgres, PostgreSQL 18 (Docker), @modelcontextprotocol/sdk 1.32.1, zod 4, vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-20-personal-finance-mcp-design.md` (§3, §4.4, §5, §9, §10).

**Plan series:** Plan 1 (file này) → Plan 2: ledger (ví, danh mục, giao dịch, chuyển khoản, đối soát + tool) → Plan 3: ngân sách, báo cáo, prompt. Plan 2/3 được viết sau khi Plan 1 chạy được với Claude thật.

---

## Quy ước cho người thực thi

- **Git:** dùng DevKit tools (`mcp__devkit__git_stage`, `mcp__devkit__git_commit`, `mcp__devkit__git_branch_create`), không chạy `git commit` trong shell. Bước "Commit" ghi rõ file và message; luôn kết thúc message bằng dòng `Co-Authored-By` theo hướng dẫn phiên.
- **Import nội bộ** luôn có hậu tố `.js` (ESM `nodenext`), ví dụ `import { getEnv } from '../config/env.js'`.
- **Chạy TypeScript:** app chạy trực tiếp bằng `bun src/main.ts`; công cụ đọc file schema TS (drizzle-kit, better-auth CLI) chạy với `--bun` để Bun phân giải `.js → .ts`.
- **Docker** phải đang chạy (Docker Desktop). Kiểm tra: `docker info` không lỗi.
- **Ba bộ test:** unit `*.spec.ts` (không DB), integration `*.int-spec.ts` (Postgres), e2e `*.e2e-spec.ts` (app thật + Postgres, cổng 3101).

## File structure

```
compose.yaml                         Postgres 18 cho dev/test
docker/postgres/init/01-roles.sql    tạo role pf_owner/pf_app và 2 database
.env.example, .env.test              biến môi trường (.env.test commit được: chỉ chứa creds dev)
drizzle.config.ts                    cấu hình drizzle-kit
drizzle/                             migrations (sinh + custom SQL)
vitest.config.ts                     unit (sửa)
vitest.config.int.ts                 integration (mới)
vitest.config.e2e.ts                 e2e (sửa)
test/setup-env.ts                    nạp .env.test trước khi import module app
test/global-setup.ts                 reset schema test DB + chạy migrations
test/app.ts                          khởi động app Nest thật cho e2e
test/oauth-flow.ts                   helper chạy luồng OAuth đầy đủ bằng fetch
src/main.ts                          entrypoint (sửa)
src/bootstrap.ts                     mount better-auth + body parser
src/app.module.ts                    (sửa) gom module
src/health.controller.ts             GET /healthz
src/config/env.ts                    parse + validate env (zod)
src/db/client.ts                     tạo pool + drizzle, kiểu Db/Tx
src/db/index.ts                      singleton db/pool theo env
src/db/db.module.ts                  provider DB cho Nest, đóng pool khi shutdown
src/db/migrate.ts, migrate-cli.ts    chạy migrations
src/db/request-context.ts            AsyncLocalStorage chứa tx + actor
src/db/run-as-user.ts                transaction + set_config app.user_id
src/db/schema/auth.ts                SINH bởi better-auth CLI
src/db/schema/audit.ts               bảng audit_log
src/db/schema/index.ts               re-export schema
src/auth/constants.ts                scope, URL resource/issuer
src/auth/allowlist.ts                kiểm tra email được phép đăng ký
src/auth/auth.ts                     instance better-auth + oauthProvider
src/well-known/protected-resource.ts metadata RFC 9728
src/well-known/well-known.controller.ts
src/pages/pages.controller.ts        /login, /consent, /assets/*
src/pages/assets/{login.html,consent.html,login.js,consent.js,style.css}
src/mcp/mcp-auth.service.ts          xác thực bearer → AuthInfo
src/mcp/tool-kit.ts                  ToolError, requireScope, toolResult, toolError
src/mcp/tools/whoami.tool.ts         tool kiểm tra kết nối
src/mcp/mcp-server.factory.ts        tạo McpServer + đăng ký tool
src/mcp/mcp.controller.ts            POST/GET/DELETE /mcp
```

Xoá: `src/app.controller.ts`, `src/app.service.ts`, `src/app.controller.spec.ts`, `test/app.e2e-spec.ts` (thay bằng health).

---

### Task 0: Tạo nhánh

- [ ] **Step 1: Tạo và chuyển sang nhánh mới**

Dùng `mcp__devkit__git_branch_create` với tên `feat/foundation-mcp-connect` (từ `main`), rồi `mcp__devkit__git_checkout` sang nhánh đó nếu tool không tự chuyển.

- [ ] **Step 2: Commit spec + plan**

Stage `docs/superpowers/specs/2026-10-20-personal-finance-mcp-design.md` và `docs/superpowers/plans/2026-10-20-plan-1-foundation-mcp-connect.md`, commit:

```
docs: add personal finance MCP design spec and plan 1
```

---

### Task 1: Dependencies, scripts, cấu hình env

**Files:**
- Modify: `package.json`
- Create: `src/config/env.ts`, `src/config/env.spec.ts`, `.env.example`

- [ ] **Step 1: Cài dependencies**

```bash
cd /home/ptvu3/Downloads/personal-finance
bun add better-auth@1.7.11 @better-auth/oauth-provider@1.7.11 drizzle-orm@0.45.4 pg@8.23.1 zod@^4.5.4 @modelcontextprotocol/sdk@1.32.1
bun add -d drizzle-kit@0.31.11 @types/pg
```

Expected: `bun.lock` cập nhật, không lỗi peer dependency.

- [ ] **Step 2: Sửa `scripts` trong `package.json`**

Thay toàn bộ khối `"scripts"` bằng:

```json
  "scripts": {
    "start:dev": "bun --watch src/main.ts",
    "start:prod": "bun src/main.ts",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "lint": "oxlint --type-aware src/ test/",
    "db:up": "docker compose up -d db",
    "db:down": "docker compose down",
    "db:generate": "bun --bun drizzle-kit generate",
    "db:migrate": "bun src/db/migrate-cli.ts",
    "auth:schema": "bunx --bun auth@1.7.11 generate --config src/auth/auth.ts --output src/db/schema/auth.ts --yes",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage",
    "test:int": "vitest run --config ./vitest.config.int.ts",
    "test:e2e": "vitest run --config ./vitest.config.e2e.ts"
  },
```

- [ ] **Step 3: Viết test thất bại cho env**

`src/config/env.spec.ts`:

```ts
import { parseEnv } from './env.js';

const base = {
  BASE_URL: 'https://finance.example.com/',
  DATABASE_URL: 'postgres://pf_app:pf_app@localhost:5433/personal_finance',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
};

describe('parseEnv', () => {
  it('applies defaults and trims trailing slash from BASE_URL', () => {
    const env = parseEnv(base);
    expect(env.BASE_URL).toBe('https://finance.example.com');
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.allowedEmails.size).toBe(0);
  });

  it('normalises ALLOWED_EMAILS into a lowercase set', () => {
    const env = parseEnv({ ...base, ALLOWED_EMAILS: ' A@Example.com, b@example.com ,,' });
    expect([...env.allowedEmails]).toEqual(['a@example.com', 'b@example.com']);
  });

  it('rejects a short BETTER_AUTH_SECRET', () => {
    expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: 'short' })).toThrow();
  });

  it('rejects a missing DATABASE_URL', () => {
    const { DATABASE_URL: _omit, ...rest } = base;
    expect(() => parseEnv(rest)).toThrow();
  });
});
```

- [ ] **Step 4: Chạy test, xác nhận thất bại**

Run: `bun run test src/config/env.spec.ts`
Expected: FAIL — `Cannot find module './env.js'` (hoặc tương đương).

- [ ] **Step 5: Implement `src/config/env.ts`**

```ts
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  MIGRATION_DATABASE_URL: z.string().min(1).optional(),
  BETTER_AUTH_SECRET: z.string().min(32),
  ALLOWED_EMAILS: z.string().default(''),
});

export type Env = Omit<z.infer<typeof EnvSchema>, 'ALLOWED_EMAILS'> & {
  allowedEmails: ReadonlySet<string>;
};

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const { ALLOWED_EMAILS, ...parsed } = EnvSchema.parse(raw);
  return {
    ...parsed,
    BASE_URL: parsed.BASE_URL.replace(/\/+$/, ''),
    allowedEmails: new Set(
      ALLOWED_EMAILS.split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  };
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
```

- [ ] **Step 6: Chạy test, xác nhận pass**

Run: `bun run test src/config/env.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Tạo `.env.example`**

```dotenv
NODE_ENV=development
PORT=3000
# URL công khai (HTTPS khi connect Claude/ChatGPT), không có dấu / cuối
BASE_URL=http://localhost:3000
# Role runtime (bị RLS ràng buộc)
DATABASE_URL=postgres://pf_app:pf_app@localhost:5433/personal_finance
# Role sở hữu bảng, chỉ dùng để chạy migration
MIGRATION_DATABASE_URL=postgres://pf_owner:pf_owner@localhost:5433/personal_finance
# Tạo bằng: openssl rand -base64 32
BETTER_AUTH_SECRET=change-me-change-me-change-me-change-me
# Danh sách email được phép tạo tài khoản, phân tách bằng dấu phẩy
ALLOWED_EMAILS=you@example.com
```

Sau đó `cp .env.example .env` (file `.env` đã nằm trong `.gitignore`).

- [ ] **Step 8: Commit**

Stage `package.json`, `bun.lock`, `src/config/env.ts`, `src/config/env.spec.ts`, `.env.example`. Message:

```
chore: add core dependencies, scripts and env validation
```

---

### Task 2: Postgres qua Docker

**Files:**
- Create: `compose.yaml`, `docker/postgres/init/01-roles.sql`, `.env.test`

- [ ] **Step 1: Tạo `compose.yaml`**

```yaml
services:
  db:
    image: postgres:18
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - '5433:5432'
    volumes:
      - pgdata:/var/lib/postgresql
      - ./docker/postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 2s
      timeout: 3s
      retries: 30

volumes:
  pgdata:
```

- [ ] **Step 2: Tạo `docker/postgres/init/01-roles.sql`**

```sql
-- Chạy một lần khi volume trống, với quyền superuser.
CREATE ROLE pf_owner LOGIN PASSWORD 'pf_owner';
CREATE ROLE pf_app LOGIN PASSWORD 'pf_app';

CREATE DATABASE personal_finance OWNER pf_owner;
CREATE DATABASE personal_finance_test OWNER pf_owner;
```

- [ ] **Step 3: Tạo `.env.test`**

```dotenv
NODE_ENV=test
PORT=3101
BASE_URL=http://localhost:3101
DATABASE_URL=postgres://pf_app:pf_app@localhost:5433/personal_finance_test
MIGRATION_DATABASE_URL=postgres://pf_owner:pf_owner@localhost:5433/personal_finance_test
BETTER_AUTH_SECRET=test-secret-test-secret-test-secret-0123456789
ALLOWED_EMAILS=allowed@example.com,oauth-e2e@example.com
```

- [ ] **Step 4: Khởi động và kiểm tra**

```bash
bun run db:up
docker compose exec db psql -U postgres -c '\l' | grep personal_finance
```

Expected: hai dòng `personal_finance` và `personal_finance_test`, owner `pf_owner`.

- [ ] **Step 5: Commit**

Stage `compose.yaml`, `docker/postgres/init/01-roles.sql`, `.env.test`. Message:

```
chore: add postgres 18 docker setup with owner and app roles
```

---

### Task 3: Drizzle client, migrations runner, request context

**Files:**
- Create: `drizzle.config.ts`, `src/db/client.ts`, `src/db/index.ts`, `src/db/migrate.ts`, `src/db/migrate-cli.ts`, `src/db/request-context.ts`, `src/db/run-as-user.ts`, `src/db/db.module.ts`, `src/db/schema/index.ts`, `src/db/schema/auth.ts` (placeholder)

- [ ] **Step 1: `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL ?? '' },
});
```

- [ ] **Step 2: Placeholder schema (sẽ bị CLI ghi đè ở Task 4)**

`src/db/schema/auth.ts`:

```ts
// Sinh bởi `bun run auth:schema`. Không sửa tay.
export {};
```

`src/db/schema/index.ts`:

```ts
export * from './auth.js';
```

- [ ] **Step 3: `src/db/client.ts`**

```ts
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(connectionString: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString });
  return { db: drizzle(pool, { schema }), pool };
}
```

- [ ] **Step 4: `src/db/index.ts`**

```ts
import { getEnv } from '../config/env.js';
import { createDb } from './client.js';

export const { db, pool } = createDb(getEnv().DATABASE_URL);
```

- [ ] **Step 5: `src/db/migrate.ts` và `src/db/migrate-cli.ts`**

```ts
// src/db/migrate.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  } finally {
    await pool.end();
  }
}
```

```ts
// src/db/migrate-cli.ts
import { runMigrations } from './migrate.js';

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL is required');
await runMigrations(url);
console.log('Migrations applied');
```

- [ ] **Step 6: `src/db/request-context.ts`**

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Tx } from './client.js';

export interface Actor {
  userId: string;
  clientId: string | null;
  scopes: readonly string[];
}

export interface RequestContext extends Actor {
  tx: Tx;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runInContext<T>(context: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

export function currentContext(): RequestContext {
  const context = storage.getStore();
  if (!context) throw new Error('No request context. Wrap the call in runAsUser().');
  return context;
}
```

- [ ] **Step 7: `src/db/run-as-user.ts`**

```ts
import { sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { type Actor, runInContext } from './request-context.js';

/**
 * Chạy `fn` trong một transaction mà RLS thấy `app.user_id = actor.userId`.
 * Mọi truy vấn domain phải lấy `tx` từ currentContext().
 */
export function runAsUser<T>(db: Db, actor: Actor, fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${actor.userId}, true)`);
    return runInContext({ ...actor, tx }, fn);
  });
}
```

- [ ] **Step 8: `src/db/db.module.ts`**

```ts
import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { db, pool } from './index.js';

export const DB = Symbol('DB');

@Global()
@Module({
  providers: [{ provide: DB, useValue: db }],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await pool.end();
  }
}
```

- [ ] **Step 9: Typecheck**

Run: `bun run typecheck`
Expected: không lỗi. (Nếu lỗi do `src/app.controller.spec.ts` thì bỏ qua — file bị xoá ở Task 7.)

- [ ] **Step 10: Commit**

Stage các file trên. Message:

```
feat(db): add drizzle client, migration runner and per-user request context
```

---

### Task 4: better-auth + oauth-provider, sinh schema auth

**Files:**
- Create: `src/auth/constants.ts`, `src/auth/allowlist.ts`, `src/auth/allowlist.spec.ts`, `src/auth/auth.ts`
- Generate: `src/db/schema/auth.ts`

- [ ] **Step 1: Test thất bại cho allowlist**

`src/auth/allowlist.spec.ts`:

```ts
import { isEmailAllowed } from './allowlist.js';

describe('isEmailAllowed', () => {
  const allowed = new Set(['owner@example.com']);

  it('accepts an allowlisted email regardless of case and whitespace', () => {
    expect(isEmailAllowed('  Owner@Example.COM ', allowed)).toBe(true);
  });

  it('rejects other emails', () => {
    expect(isEmailAllowed('stranger@example.com', allowed)).toBe(false);
  });

  it('rejects everything when the allowlist is empty', () => {
    expect(isEmailAllowed('owner@example.com', new Set())).toBe(false);
  });
});
```

Run: `bun run test src/auth/allowlist.spec.ts` → FAIL (module không tồn tại).

- [ ] **Step 2: Implement `src/auth/allowlist.ts`**

```ts
export function isEmailAllowed(email: string, allowed: ReadonlySet<string>): boolean {
  return allowed.has(email.trim().toLowerCase());
}
```

Run: `bun run test src/auth/allowlist.spec.ts` → PASS (3 tests).

- [ ] **Step 3: `src/auth/constants.ts`**

```ts
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
```

- [ ] **Step 4: `src/auth/auth.ts`**

```ts
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
```

- [ ] **Step 5: Sinh schema Drizzle cho better-auth**

```bash
bun run auth:schema
```

Expected: `src/db/schema/auth.ts` bị ghi đè, chứa `pgTable` cho `user`, `session`, `account`, `verification`, `oauthClient`, `oauthResource`, `oauthClientResource`, `oauthRefreshToken`, `oauthAccessToken`, `oauthConsent` (tên export có thể khác chút). Kiểm tra:

```bash
grep -nE "^export const \w+ = pgTable" src/db/schema/auth.ts
```

Ghi lại **tên export của bảng user** (kỳ vọng `user`) — Task 5 import nó. Nếu tên khác (vd `users`), dùng đúng tên đó ở Task 5 Step 1. Nếu CLI báo không đọc được config vì thiếu env, chạy lại với `.env` đã tạo ở Task 1 Step 7 (Bun tự nạp `.env` trong thư mục hiện tại).

Thêm dòng đầu file (CLI không tự thêm):

```ts
// Sinh bởi `bun run auth:schema`. Không sửa tay.
```

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: không lỗi trong `src/auth/**`, `src/db/**`.

- [ ] **Step 7: Commit**

Stage `src/auth/*`, `src/db/schema/auth.ts`. Message:

```
feat(auth): configure better-auth with oauth provider for MCP clients
```

---

### Task 5: Bảng audit_log, grants, RLS và migrations

**Files:**
- Create: `src/db/schema/audit.ts`
- Modify: `src/db/schema/index.ts`
- Generate: `drizzle/0000_*.sql` (grants, custom), `drizzle/0001_*.sql` (bảng), `drizzle/0002_*.sql` (RLS, custom)

- [ ] **Step 1: Migration custom cấp quyền (phải là migration đầu tiên)**

```bash
bun run db:generate --custom --name=app_role_grants
```

Mở file `drizzle/0000_app_role_grants.sql` vừa tạo, ghi nội dung:

```sql
GRANT USAGE ON SCHEMA public TO pf_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE pf_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pf_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE pf_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO pf_app;
```

- [ ] **Step 2: `src/db/schema/audit.ts`**

```ts
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    actorClientId: text('actor_client_id'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_user_at_idx').on(t.userId, t.at)],
);
```

(`uuidv7()` có sẵn từ PostgreSQL 18.)

`src/db/schema/index.ts`:

```ts
export * from './auth.js';
export * from './audit.js';
```

- [ ] **Step 3: Sinh migration cho bảng**

```bash
bun run db:generate --name=auth_and_audit
```

Expected: `drizzle/0001_auth_and_audit.sql` chứa `CREATE TABLE "user"`, … , `CREATE TABLE "audit_log"`.

- [ ] **Step 4: Migration custom RLS**

```bash
bun run db:generate --custom --name=audit_log_rls
```

Ghi vào `drizzle/0002_audit_log_rls.sql`:

```sql
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "audit_log_owner" ON "audit_log" TO pf_app
  USING ("user_id" = current_setting('app.user_id', true))
  WITH CHECK ("user_id" = current_setting('app.user_id', true));
```

- [ ] **Step 5: Áp dụng lên DB dev**

```bash
bun run db:migrate
docker compose exec db psql -U postgres -d personal_finance -c '\dp audit_log'
```

Expected: `Migrations applied`; `\dp` cho thấy `pf_app=arwd/pf_owner` và có policy `audit_log_owner`.

- [ ] **Step 6: Commit**

Stage `src/db/schema/audit.ts`, `src/db/schema/index.ts`, `drizzle/`. Message:

```
feat(db): add audit_log with row level security and app role grants
```

---

### Task 6: Hạ tầng test DB + test RLS và đăng ký có allowlist

**Files:**
- Create: `test/setup-env.ts`, `test/global-setup.ts`, `vitest.config.int.ts`, `src/db/run-as-user.int-spec.ts`, `src/auth/sign-up.int-spec.ts`
- Modify: `vitest.config.e2e.ts`

- [ ] **Step 1: `test/setup-env.ts`**

```ts
// Chạy trong mỗi worker trước khi file test import module của app.
process.loadEnvFile('.env.test');
```

- [ ] **Step 2: `test/global-setup.ts`**

```ts
import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';

export default async function globalSetup(): Promise<void> {
  process.loadEnvFile('.env.test');
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL missing in .env.test');

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
    );
  } finally {
    await client.end();
  }
  await runMigrations(url);
}
```

- [ ] **Step 3: `vitest.config.int.ts` và sửa `vitest.config.e2e.ts`**

```ts
// vitest.config.int.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.int-spec.ts'],
    setupFiles: ['./test/setup-env.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
  },
});
```

```ts
// vitest.config.e2e.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup-env.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
```

- [ ] **Step 4: Viết test RLS**

`src/db/run-as-user.int-spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, pool } from './index.js';
import { currentContext } from './request-context.js';
import { runAsUser } from './run-as-user.js';
import { auditLog, user } from './schema/index.js';

async function createUser(): Promise<string> {
  const id = randomUUID();
  // Bảng user không bật RLS: tạo trực tiếp cho test.
  await db.insert(user).values({
    id,
    name: 'Test',
    email: `${id}@example.com`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

const actor = (userId: string) => ({ userId, clientId: 'test-client', scopes: [] as string[] });

describe('runAsUser + RLS', () => {
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    alice = await createUser();
    bob = await createUser();
    await runAsUser(db, actor(alice), async () => {
      await currentContext().tx.insert(auditLog).values({ userId: alice, action: 'test', entity: 'probe' });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('exposes the actor and sets app.user_id inside the transaction', async () => {
    await runAsUser(db, actor(alice), async () => {
      const { tx, userId } = currentContext();
      const result = await tx.execute<{ value: string }>(sql`select current_setting('app.user_id', true) as value`);
      expect(userId).toBe(alice);
      expect(result.rows[0]?.value).toBe(alice);
    });
  });

  it('lets a user read their own rows', async () => {
    const rows = await runAsUser(db, actor(alice), () => currentContext().tx.select().from(auditLog));
    expect(rows.map((r) => r.userId)).toEqual([alice]);
  });

  it('hides other users rows even without a WHERE clause', async () => {
    const rows = await runAsUser(db, actor(bob), () => currentContext().tx.select().from(auditLog));
    expect(rows).toEqual([]);
  });

  it('returns no rows when no user context is set (fail closed)', async () => {
    const rows = await db.select().from(auditLog);
    expect(rows).toEqual([]);
  });

  it('rejects writing a row for another user', async () => {
    await expect(
      runAsUser(db, actor(bob), async () => {
        await currentContext().tx.insert(auditLog).values({ userId: alice, action: 'x', entity: 'probe' });
      }),
    ).rejects.toThrow(/row-level security/);
  });
});
```

Nếu Task 4 Step 5 ghi nhận tên cột/field user khác (`emailVerified`, `createdAt`…), sửa object `values` theo đúng schema đã sinh.

- [ ] **Step 5: Viết test đăng ký có allowlist**

`src/auth/sign-up.int-spec.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db, pool } from '../db/index.js';
import { user } from '../db/schema/index.js';
import { auth } from './auth.js';

describe('sign-up allowlist', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('rejects an email that is not allowlisted', async () => {
    await expect(
      auth.api.signUpEmail({
        body: { name: 'Stranger', email: 'stranger@example.com', password: 'password-123' },
      }),
    ).rejects.toThrow(/không được phép/);
  });

  it('creates an allowlisted user with default currency and timezone', async () => {
    await auth.api.signUpEmail({
      body: { name: 'Owner', email: 'allowed@example.com', password: 'password-123' },
    });
    const [row] = await db.select().from(user).where(eq(user.email, 'allowed@example.com'));
    expect(row?.baseCurrency).toBe('VND');
    expect(row?.timezone).toBe('Asia/Ho_Chi_Minh');
  });
});
```

- [ ] **Step 6: Chạy integration tests**

Run: `bun run test:int`
Expected: PASS — 7 tests (5 RLS + 2 sign-up). Nếu test "rejects writing a row for another user" báo lỗi với message khác, xác nhận lỗi là `new row violates row-level security policy` rồi chỉnh regex cho khớp.

- [ ] **Step 7: Commit**

Stage `test/setup-env.ts`, `test/global-setup.ts`, `vitest.config.int.ts`, `vitest.config.e2e.ts`, `src/db/run-as-user.int-spec.ts`, `src/auth/sign-up.int-spec.ts`. Message:

```
test: add integration test harness, RLS isolation and sign-up allowlist tests
```

---

### Task 7: Bootstrap Nest — mount better-auth, health check

**Files:**
- Create: `src/bootstrap.ts`, `src/health.controller.ts`, `test/app.ts`, `test/health.e2e-spec.ts`
- Modify: `src/main.ts`, `src/app.module.ts`
- Delete: `src/app.controller.ts`, `src/app.service.ts`, `src/app.controller.spec.ts`, `test/app.e2e-spec.ts`

- [ ] **Step 1: Xoá code mẫu**

```bash
rm src/app.controller.ts src/app.service.ts src/app.controller.spec.ts test/app.e2e-spec.ts
```

- [ ] **Step 2: Viết e2e test thất bại**

`test/app.ts`:

```ts
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
```

`test/health.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { startApp } from './app.js';

describe('health', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /healthz returns ok', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('better-auth is mounted under /api/auth', async () => {
    const res = await fetch(`${baseUrl}/api/auth/ok`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('parses JSON bodies for Nest routes', async () => {
    const res = await fetch(`${baseUrl}/healthz/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ping: 1 }),
    });
    expect(await res.json()).toEqual({ ping: 1 });
  });
});
```

Run: `bun run test:e2e` → FAIL (`../src/bootstrap.js` không tồn tại).

- [ ] **Step 3: `src/health.controller.ts`**

```ts
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';

@Controller('healthz')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }

  // Chỉ để kiểm tra body parser của Nest vẫn hoạt động sau khi mount better-auth.
  @Post('echo')
  @HttpCode(200)
  echo(@Body() body: unknown): unknown {
    return body;
  }
}
```

- [ ] **Step 4: `src/bootstrap.ts`**

```ts
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
```

- [ ] **Step 5: `src/app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [DbModule],
  controllers: [HealthController],
})
export class AppModule {}
```

- [ ] **Step 6: `src/main.ts`**

```ts
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { getEnv } from './config/env.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
configureApp(app);
await app.listen(getEnv().PORT);
```

- [ ] **Step 7: Chạy e2e**

Run: `bun run test:e2e`
Expected: PASS (3 tests).

- [ ] **Step 8: Chạy thử bằng Bun**

```bash
(timeout 8 bun src/main.ts &) ; sleep 3; curl -s localhost:3000/healthz; echo; curl -s localhost:3000/api/auth/ok
```

Expected: `{"status":"ok"}` và `{"ok":true}`.

- [ ] **Step 9: Commit**

Stage các file tạo/sửa/xoá trong task. Message:

```
feat: bootstrap nest on bun with better-auth mounted before body parsers
```

---

### Task 8: Discovery `.well-known`

**Files:**
- Create: `src/well-known/protected-resource.ts`, `src/well-known/protected-resource.spec.ts`, `src/well-known/well-known.controller.ts`, `test/well-known.e2e-spec.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Unit test thất bại**

`src/well-known/protected-resource.spec.ts`:

```ts
import { protectedResourceMetadata } from './protected-resource.js';

describe('protectedResourceMetadata', () => {
  it('points the MCP resource at the better-auth issuer', () => {
    expect(protectedResourceMetadata('https://fin.example.com')).toEqual({
      resource: 'https://fin.example.com/mcp',
      authorization_servers: ['https://fin.example.com/api/auth'],
      scopes_supported: ['offline_access', 'finance:read', 'finance:write'],
      bearer_methods_supported: ['header'],
      resource_name: 'Personal Finance',
    });
  });
});
```

Run: `bun run test src/well-known` → FAIL.

- [ ] **Step 2: `src/well-known/protected-resource.ts`**

```ts
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
```

Run: `bun run test src/well-known` → PASS.

- [ ] **Step 3: E2E test thất bại**

`test/well-known.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { startApp } from './app.js';

describe('.well-known discovery', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource'])(
    'GET %s returns protected resource metadata',
    async (path) => {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.resource).toBe(`${baseUrl}/mcp`);
      expect(body.authorization_servers).toEqual([`${baseUrl}/api/auth`]);
    },
  );

  it.each(['/.well-known/oauth-authorization-server/api/auth', '/.well-known/oauth-authorization-server'])(
    'GET %s returns authorization server metadata with DCR and PKCE',
    async (path) => {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.issuer).toBe(`${baseUrl}/api/auth`);
      expect(body.registration_endpoint).toBe(`${baseUrl}/api/auth/oauth2/register`);
      expect(body.token_endpoint).toBe(`${baseUrl}/api/auth/oauth2/token`);
      expect(body.code_challenge_methods_supported).toContain('S256');
      expect(body.token_endpoint_auth_methods_supported).toContain('none');
    },
  );
});
```

- [ ] **Step 4: `src/well-known/well-known.controller.ts`**

```ts
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
```

Thêm `WellKnownController` vào `controllers` của `AppModule`:

```ts
import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health.controller.js';
import { WellKnownController } from './well-known/well-known.controller.js';

@Module({
  imports: [DbModule],
  controllers: [HealthController, WellKnownController],
})
export class AppModule {}
```

- [ ] **Step 5: Chạy e2e**

Run: `bun run test:e2e test/well-known.e2e-spec.ts`
Expected: PASS (4 tests). Nếu `getOAuthServerConfig` không tồn tại hoặc trả `Response`, đổi sang `await auth.api.getOAuthServerConfig({ headers: new Headers() })` hoặc đọc `.json()` của Response; giữ nguyên assertion.

- [ ] **Step 6: Commit**

Message:

```
feat: serve oauth protected resource and authorization server metadata
```

---

### Task 9: Trang `/login` và `/consent`

**Files:**
- Create: `src/pages/pages.controller.ts`, `src/pages/assets/login.html`, `src/pages/assets/consent.html`, `src/pages/assets/login.js`, `src/pages/assets/consent.js`, `src/pages/assets/style.css`, `test/pages.e2e-spec.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: E2E test thất bại**

`test/pages.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { startApp } from './app.js';

describe('pages', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['/login', 'text/html', 'auth-form'],
    ['/consent', 'text/html', 'consent-actions'],
    ['/assets/login.js', 'text/javascript', 'oauth_query'],
    ['/assets/consent.js', 'text/javascript', '/api/auth/oauth2/consent'],
    ['/assets/style.css', 'text/css', 'body'],
  ])('GET %s serves %s', async (path, type, marker) => {
    const res = await fetch(`${baseUrl}${path}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(type);
    expect(await res.text()).toContain(marker);
  });

  it('sends a strict CSP on HTML pages', async () => {
    const res = await fetch(`${baseUrl}/login`);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
```

Run: `bun run test:e2e test/pages.e2e-spec.ts` → FAIL (404).

- [ ] **Step 2: `src/pages/assets/style.css`**

```css
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
main { width: min(24rem, 90vw); padding: 2rem; }
h1 { font-size: 1.4rem; margin: 0 0 0.5rem; }
label { display: grid; gap: 0.25rem; margin-bottom: 0.75rem; }
input { padding: 0.6rem; font-size: 1rem; }
button { padding: 0.6rem 1rem; font-size: 1rem; cursor: pointer; }
button.link { background: none; border: none; padding: 0; text-decoration: underline; margin-top: 1rem; }
.actions { display: flex; gap: 0.5rem; }
[role='alert'] { color: #c0392b; }
```

- [ ] **Step 3: `src/pages/assets/login.html`**

```html
<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Đăng nhập · Personal Finance</title>
    <link rel="stylesheet" href="/assets/style.css" />
  </head>
  <body>
    <main>
      <h1>Personal Finance</h1>
      <p>Đăng nhập để kết nối trợ lý AI với dữ liệu tài chính của bạn.</p>
      <form id="auth-form">
        <label id="name-field" hidden>Tên <input name="name" autocomplete="name" /></label>
        <label>Email <input name="email" type="email" autocomplete="email" required /></label>
        <label>
          Mật khẩu
          <input name="password" type="password" autocomplete="current-password" minlength="8" required />
        </label>
        <p id="error" role="alert" hidden></p>
        <button type="submit" id="submit">Đăng nhập</button>
      </form>
      <button type="button" id="toggle-mode" class="link">Chưa có tài khoản? Tạo tài khoản</button>
    </main>
    <script type="module" src="/assets/login.js"></script>
  </body>
</html>
```

- [ ] **Step 4: `src/pages/assets/login.js`**

```js
// better-auth chuyển hướng tới /login kèm query đã ký. Gửi nguyên query đó trong `oauth_query`
// để plugin oauth-provider tiếp tục luồng authorize sau khi đăng nhập.
const form = document.getElementById('auth-form');
const errorEl = document.getElementById('error');
const nameField = document.getElementById('name-field');
const submit = document.getElementById('submit');
const toggle = document.getElementById('toggle-mode');
let mode = 'sign-in';

toggle.addEventListener('click', () => {
  mode = mode === 'sign-in' ? 'sign-up' : 'sign-in';
  const signUp = mode === 'sign-up';
  nameField.hidden = !signUp;
  nameField.querySelector('input').required = signUp;
  submit.textContent = signUp ? 'Tạo tài khoản' : 'Đăng nhập';
  toggle.textContent = signUp ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Tạo tài khoản';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  submit.disabled = true;
  const data = new FormData(form);
  const body = {
    email: data.get('email'),
    password: data.get('password'),
    oauth_query: location.search.slice(1),
  };
  if (mode === 'sign-up') body.name = data.get('name');
  try {
    const res = await fetch(`/api/auth/${mode}/email`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.message || 'Đăng nhập thất bại.');
    if (payload.redirect && payload.url) {
      location.href = payload.url;
      return;
    }
    throw new Error('Không có phiên kết nối đang chờ. Hãy bắt đầu kết nối lại từ Claude hoặc ChatGPT.');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
    submit.disabled = false;
  }
});
```

- [ ] **Step 5: `src/pages/assets/consent.html`**

```html
<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cấp quyền · Personal Finance</title>
    <link rel="stylesheet" href="/assets/style.css" />
  </head>
  <body>
    <main>
      <h1>Cấp quyền truy cập</h1>
      <p><strong id="client-name"></strong> muốn:</p>
      <ul id="scopes"></ul>
      <p id="error" role="alert" hidden></p>
      <div class="actions" id="consent-actions">
        <button type="button" id="accept">Đồng ý</button>
        <button type="button" id="deny">Từ chối</button>
      </div>
    </main>
    <script type="module" src="/assets/consent.js"></script>
  </body>
</html>
```

- [ ] **Step 6: `src/pages/assets/consent.js`**

```js
const SCOPE_LABELS = {
  'finance:read': 'Xem dữ liệu tài chính (ví, giao dịch, ngân sách, báo cáo)',
  'finance:write': 'Ghi, sửa và xoá dữ liệu tài chính',
  offline_access: 'Giữ kết nối khi bạn không mở trang này',
};

const params = new URLSearchParams(location.search);
const clientId = params.get('client_id') ?? '';
const scopes = (params.get('scope') ?? '').split(' ').filter(Boolean);
const clientName = document.getElementById('client-name');
const list = document.getElementById('scopes');
const errorEl = document.getElementById('error');
const buttons = [document.getElementById('accept'), document.getElementById('deny')];

// textContent (không innerHTML): tên client do bên ngoài đăng ký.
clientName.textContent = clientId || 'Ứng dụng không xác định';
for (const scope of scopes) {
  const item = document.createElement('li');
  item.textContent = SCOPE_LABELS[scope] ?? scope;
  list.append(item);
}

fetch(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`, { credentials: 'include' })
  .then((res) => (res.ok ? res.json() : null))
  .then((client) => {
    if (client?.client_name) clientName.textContent = client.client_name;
  })
  .catch(() => {});

async function decide(accept) {
  errorEl.hidden = true;
  for (const button of buttons) button.disabled = true;
  try {
    const res = await fetch('/api/auth/oauth2/consent', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accept, oauth_query: location.search.slice(1) }),
    });
    const payload = await res.json().catch(() => ({}));
    if (res.ok && payload.url) {
      location.href = payload.url;
      return;
    }
    throw new Error(payload.message || payload.error_description || 'Không xử lý được yêu cầu cấp quyền.');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
    for (const button of buttons) button.disabled = false;
  }
}

buttons[0].addEventListener('click', () => decide(true));
buttons[1].addEventListener('click', () => decide(false));
```

- [ ] **Step 7: `src/pages/pages.controller.ts`**

```ts
import { readFileSync } from 'node:fs';
import { Controller, Get, Header } from '@nestjs/common';

const asset = (name: string): string => readFileSync(new URL(`./assets/${name}`, import.meta.url), 'utf8');

const LOGIN_HTML = asset('login.html');
const CONSENT_HTML = asset('consent.html');
const LOGIN_JS = asset('login.js');
const CONSENT_JS = asset('consent.js');
const STYLE_CSS = asset('style.css');

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
  "form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

@Controller()
export class PagesController {
  @Get('login')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Content-Security-Policy', CSP)
  @Header('Cache-Control', 'no-store')
  login(): string {
    return LOGIN_HTML;
  }

  @Get('consent')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Content-Security-Policy', CSP)
  @Header('Cache-Control', 'no-store')
  consent(): string {
    return CONSENT_HTML;
  }

  @Get('assets/login.js')
  @Header('Content-Type', 'text/javascript; charset=utf-8')
  loginScript(): string {
    return LOGIN_JS;
  }

  @Get('assets/consent.js')
  @Header('Content-Type', 'text/javascript; charset=utf-8')
  consentScript(): string {
    return CONSENT_JS;
  }

  @Get('assets/style.css')
  @Header('Content-Type', 'text/css; charset=utf-8')
  style(): string {
    return STYLE_CSS;
  }
}
```

Thêm `PagesController` vào `controllers` của `AppModule` (giữ các controller cũ).

- [ ] **Step 8: Chạy e2e**

Run: `bun run test:e2e test/pages.e2e-spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 9: Commit**

Message:

```
feat: add minimal login and consent pages for the oauth flow
```

---

### Task 10: Endpoint MCP, xác thực bearer, tool `whoami`

**Files:**
- Create: `src/mcp/mcp-auth.service.ts`, `src/mcp/tool-kit.ts`, `src/mcp/tool-kit.spec.ts`, `src/mcp/tools/whoami.tool.ts`, `src/mcp/mcp-server.factory.ts`, `src/mcp/mcp.controller.ts`, `test/mcp-auth.e2e-spec.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Unit test thất bại cho tool-kit**

`src/mcp/tool-kit.spec.ts`:

```ts
import { ToolError, toolError, toolResult } from './tool-kit.js';

describe('tool-kit', () => {
  it('toolResult returns text summary plus structured content', () => {
    expect(toolResult({ a: 1 }, 'xong')).toEqual({
      content: [{ type: 'text', text: 'xong' }],
      structuredContent: { a: 1 },
    });
  });

  it('toolError converts a ToolError into an isError result without structuredContent', () => {
    const result = toolError(new ToolError('ACCOUNT_NOT_FOUND', 'Không thấy ví', { candidates: ['Momo'] }));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      code: 'ACCOUNT_NOT_FOUND',
      message: 'Không thấy ví',
      details: { candidates: ['Momo'] },
    });
  });

  it('toolError rethrows unexpected errors', () => {
    expect(() => toolError(new Error('boom'))).toThrow('boom');
  });
});
```

Run: `bun run test src/mcp` → FAIL.

- [ ] **Step 2: `src/mcp/tool-kit.ts`**

```ts
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { currentContext } from '../db/request-context.js';

/** Lỗi nghiệp vụ trả về cho agent để nó tự sửa và gọi lại. */
export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function requireScope(scope: string): void {
  if (!currentContext().scopes.includes(scope)) {
    throw new ToolError('INSUFFICIENT_SCOPE', `Kết nối này chưa được cấp quyền ${scope}. Hãy kết nối lại và cấp quyền.`);
  }
}

export function toolResult(data: Record<string, unknown>, summary: string): CallToolResult {
  return { content: [{ type: 'text', text: summary }], structuredContent: data };
}

/**
 * Không gửi structuredContent khi lỗi: client SDK kiểm tra structuredContent theo outputSchema
 * kể cả khi isError, và sẽ ném lỗi nếu không khớp.
 */
export function toolError(error: unknown): CallToolResult {
  if (!(error instanceof ToolError)) throw error;
  const body = { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }] };
}
```

Run: `bun run test src/mcp` → PASS (3 tests).

- [ ] **Step 3: `src/mcp/mcp-auth.service.ts`**

```ts
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
```

- [ ] **Step 4: `src/mcp/tools/whoami.tool.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { FINANCE_READ } from '../../auth/constants.js';
import { currentContext } from '../../db/request-context.js';
import { requireScope, toolError, toolResult } from '../tool-kit.js';

export function registerWhoamiTool(server: McpServer): void {
  server.registerTool(
    'whoami',
    {
      title: 'Kiểm tra kết nối',
      description:
        'Trả về thông tin kết nối hiện tại: user, client và các quyền đã cấp. Dùng khi cần kiểm tra kết nối hoạt động.',
      outputSchema: {
        user_id: z.string(),
        client_id: z.string(),
        scopes: z.array(z.string()),
        db_user_context: z.string(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        requireScope(FINANCE_READ);
        const { userId, clientId, scopes, tx } = currentContext();
        const result = await tx.execute<{ value: string | null }>(
          sql`select current_setting('app.user_id', true) as value`,
        );
        const data = {
          user_id: userId,
          client_id: clientId ?? '',
          scopes: [...scopes],
          db_user_context: result.rows[0]?.value ?? '',
        };
        return toolResult(data, `Kết nối hoạt động. Quyền: ${data.scopes.join(', ')}.`);
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
```

- [ ] **Step 5: `src/mcp/mcp-server.factory.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerWhoamiTool } from './tools/whoami.tool.js';

export const SERVER_INSTRUCTIONS = [
  'Đây là sổ thu chi cá nhân của người dùng.',
  'Trả lời người dùng bằng ngôn ngữ họ dùng.',
  'Khi một tool trả lỗi dạng JSON {code, message}, đọc message để sửa tham số rồi gọi lại; nếu cần lựa chọn của người dùng thì hỏi họ.',
].join('\n');

/** Tạo server mới cho mỗi request (transport stateless không dùng lại được). */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'personal-finance', version: '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerWhoamiTool(server);
  return server;
}
```

- [ ] **Step 6: `src/mcp/mcp.controller.ts`**

```ts
import { Controller, Delete, Get, Inject, Logger, Post, Req, Res } from '@nestjs/common';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { getEnv } from '../config/env.js';
import type { Db } from '../db/client.js';
import { DB } from '../db/db.module.js';
import { runAsUser } from '../db/run-as-user.js';
import { InvalidAccessTokenError, McpAuthService } from './mcp-auth.service.js';
import { createMcpServer } from './mcp-server.factory.js';

function sendUnauthorized(res: Response): void {
  const metadataUrl = `${getEnv().BASE_URL}/.well-known/oauth-protected-resource/mcp`;
  res
    .status(401)
    .set('WWW-Authenticate', `Bearer resource_metadata="${metadataUrl}"`)
    .json({ error: 'invalid_token', error_description: 'Missing or invalid access token' });
}

function sendMethodNotAllowed(res: Response): void {
  res
    .status(405)
    .set('Allow', 'POST')
    .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
}

@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly mcpAuth: McpAuthService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Post()
  async handle(@Req() req: Request & { auth?: AuthInfo }, @Res() res: Response): Promise<void> {
    let authInfo: AuthInfo;
    try {
      authInfo = await this.mcpAuth.verify(req.headers.authorization);
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) return sendUnauthorized(res);
      throw error;
    }
    req.auth = authInfo;
    const actor = {
      userId: authInfo.extra?.userId as string,
      clientId: authInfo.clientId || null,
      scopes: authInfo.scopes,
    };

    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void server.close();
    });

    try {
      await server.connect(transport);
      await runAsUser(this.db, actor, () => transport.handleRequest(req, res, req.body));
    } catch (error) {
      this.logger.error(error);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  }

  // Stateless: không có SSE stream độc lập, không có session để xoá.
  @Get()
  get(@Res() res: Response): void {
    sendMethodNotAllowed(res);
  }

  @Delete()
  remove(@Res() res: Response): void {
    sendMethodNotAllowed(res);
  }
}
```

`src/app.module.ts` (bản đầy đủ):

```ts
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
```

- [ ] **Step 7: E2E test cho lớp xác thực**

`test/mcp-auth.e2e-spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { startApp } from './app.js';

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
};

describe('/mcp authentication', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApp());
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (headers: Record<string, string>) =>
    fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify(initialize),
    });

  it('returns 401 with resource metadata pointer when no token is sent', async () => {
    const res = await post({});
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it('returns 401 for an unknown token', async () => {
    const res = await post({ authorization: 'Bearer not-a-real-token' });
    expect(res.status).toBe(401);
  });

  it.each(['GET', 'DELETE'])('%s /mcp returns 405', async (method) => {
    const res = await fetch(`${baseUrl}/mcp`, { method });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
});
```

Run: `bun run test:e2e test/mcp-auth.e2e-spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

Message:

```
feat(mcp): add stateless MCP endpoint with bearer auth and whoami tool
```

---

### Task 11: E2E luồng OAuth đầy đủ → gọi tool qua MCP client

**Files:**
- Create: `test/oauth-flow.ts`, `test/oauth-mcp.e2e-spec.ts`

- [ ] **Step 1: Helper `test/oauth-flow.ts`**

```ts
import { createHash, randomBytes } from 'node:crypto';

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  scope: string;
  expires_in: number;
  token_type: string;
}

export const REDIRECT_URI = 'http://localhost:6274/oauth/callback';
export const ALL_SCOPES = 'offline_access finance:read finance:write';

async function expectOk(res: Response, step: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${step} failed: ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

/** better-auth trả 302 (navigation) hoặc JSON { redirect, url } (fetch): chấp nhận cả hai. */
async function readRedirect(res: Response, baseUrl: string, step: string): Promise<URL> {
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location');
    if (!location) throw new Error(`${step}: redirect without location`);
    return new URL(location, baseUrl);
  }
  const body = (await expectOk(res, step)) as { url?: string };
  if (!body.url) throw new Error(`${step}: no redirect url in ${JSON.stringify(body)}`);
  return new URL(body.url, baseUrl);
}

export async function registerClient(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/oauth2/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'E2E MCP Client',
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  const body = (await expectOk(res, 'register')) as { client_id: string };
  return body.client_id;
}

/** Chạy giống Claude/ChatGPT: authorize → login → consent → đổi code lấy token (PKCE). */
export async function authorizeAndExchange(
  baseUrl: string,
  clientId: string,
  credentials: { email: string; password: string },
  scope = ALL_SCOPES,
): Promise<OAuthTokens> {
  const origin = { origin: baseUrl };
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const resource = `${baseUrl}/mcp`;

  const authorizeUrl = new URL(`${baseUrl}/api/auth/oauth2/authorize`);
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope,
    state: 'e2e-state',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource,
  }).toString();
  const loginUrl = await readRedirect(await fetch(authorizeUrl, { redirect: 'manual' }), baseUrl, 'authorize');
  if (loginUrl.pathname !== '/login') throw new Error(`authorize: expected /login, got ${loginUrl.href}`);

  const signIn = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...origin },
    body: JSON.stringify({ ...credentials, oauth_query: loginUrl.search.slice(1) }),
  });
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  let next = await readRedirect(signIn, baseUrl, 'sign-in');

  if (next.pathname === '/consent') {
    const consent = await fetch(`${baseUrl}/api/auth/oauth2/consent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, ...origin },
      body: JSON.stringify({ accept: true, oauth_query: next.search.slice(1) }),
    });
    next = await readRedirect(consent, baseUrl, 'consent');
  }

  const code = next.searchParams.get('code');
  if (!code || next.searchParams.get('state') !== 'e2e-state') {
    throw new Error(`expected callback with code and state, got ${next.href}`);
  }

  const token = await fetch(`${baseUrl}/api/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      resource,
    }),
  });
  return (await expectOk(token, 'token')) as OAuthTokens;
}

export async function refresh(baseUrl: string, clientId: string, refreshToken: string): Promise<OAuthTokens> {
  const res = await fetch(`${baseUrl}/api/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      resource: `${baseUrl}/mcp`,
    }),
  });
  return (await expectOk(res, 'refresh')) as OAuthTokens;
}
```

- [ ] **Step 2: Test `test/oauth-mcp.e2e-spec.ts`**

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { auth } from '../src/auth/auth.js';
import { startApp } from './app.js';
import { authorizeAndExchange, refresh, registerClient } from './oauth-flow.js';

const credentials = { email: 'oauth-e2e@example.com', password: 'password-123' };

async function connectMcp(baseUrl: string, accessToken: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const client = new Client({ name: 'e2e', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

describe('OAuth connect → MCP tool call', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let userId: string;

  beforeAll(async () => {
    ({ app, baseUrl } = await startApp());
    const result = await auth.api.signUpEmail({ body: { name: 'E2E', ...credentials } });
    userId = result.user.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('a dynamically registered client can connect and call whoami', async () => {
    const clientId = await registerClient(baseUrl);
    const tokens = await authorizeAndExchange(baseUrl, clientId, credentials);
    expect(tokens.refresh_token).toBeTruthy();

    const client = await connectMcp(baseUrl, tokens.access_token);
    try {
      expect(client.getInstructions()).toContain('sổ thu chi');
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('whoami');

      const result = await client.callTool({ name: 'whoami', arguments: {} });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        user_id: userId,
        client_id: clientId,
        db_user_context: userId,
      });
      expect((result.structuredContent as { scopes: string[] }).scopes).toEqual(
        expect.arrayContaining(['finance:read', 'finance:write']),
      );
    } finally {
      await client.close();
    }
  });

  it('a refreshed access token keeps working', async () => {
    const clientId = await registerClient(baseUrl);
    const first = await authorizeAndExchange(baseUrl, clientId, credentials);
    const second = await refresh(baseUrl, clientId, first.refresh_token!);
    expect(second.access_token).not.toBe(first.access_token);

    const client = await connectMcp(baseUrl, second.access_token);
    try {
      const result = await client.callTool({ name: 'whoami', arguments: {} });
      expect(result.structuredContent).toMatchObject({ user_id: userId });
    } finally {
      await client.close();
    }
  });

  it('a token without finance:read gets INSUFFICIENT_SCOPE from whoami', async () => {
    const clientId = await registerClient(baseUrl);
    const tokens = await authorizeAndExchange(baseUrl, clientId, credentials, 'offline_access finance:write');
    const client = await connectMcp(baseUrl, tokens.access_token);
    try {
      const result = await client.callTool({ name: 'whoami', arguments: {} });
      expect(result.isError).toBe(true);
      expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text).code).toBe('INSUFFICIENT_SCOPE');
    } finally {
      await client.close();
    }
  });
});
```

- [ ] **Step 3: Chạy và gỡ lỗi**

Run: `bun run test:e2e test/oauth-mcp.e2e-spec.ts`
Expected: PASS (3 tests).

Đây là test kiểm chứng rủi ro §9.2 của spec. Nếu fail, đọc message lỗi theo bước (`register`, `authorize`, `sign-in`, `consent`, `token`, `refresh`) — helper in ra status + body. Các nguyên nhân đã biết:
- `register` 401 → thiếu `allowUnauthenticatedClientRegistration: true`.
- `token` lỗi `invalid_target` → resource chưa liên kết client (`clientRegistrationDefaultResources`).
- `sign-in` 403 origin → thiếu header `origin` trùng `BASE_URL`.
- không có `refresh_token` → client chưa đăng ký grant `refresh_token` hoặc thiếu scope `offline_access`.
Sửa cấu hình trong `src/auth/auth.ts` (không nới assertion), ghi lại phát hiện vào commit message.

- [ ] **Step 4: Chạy toàn bộ test**

```bash
bun run test && bun run test:int && bun run test:e2e && bun run typecheck && bun run lint
```

Expected: tất cả PASS, không lỗi type/lint.

- [ ] **Step 5: Commit**

Message:

```
test(e2e): cover full oauth connect flow and MCP tool call with refresh
```

---

### Task 12: Kiểm thử thủ công với Claude và ChatGPT thật

**Files:**
- Modify: `README.md` (thay nội dung mẫu của Nest)

- [ ] **Step 1: Viết `README.md`**

````markdown
# Personal Finance (MCP)

Sổ thu chi cá nhân dùng qua Claude/ChatGPT bằng MCP. Thiết kế: `docs/superpowers/specs/2026-10-20-personal-finance-mcp-design.md`.

## Chạy local

```bash
cp .env.example .env        # sửa BETTER_AUTH_SECRET, ALLOWED_EMAILS
bun install
bun run db:up
bun run db:migrate
bun run start:dev
```

## Test

```bash
bun run test        # unit
bun run test:int    # integration (cần Postgres: bun run db:up)
bun run test:e2e    # e2e
```

## Kết nối Claude / ChatGPT

Connector cần URL HTTPS công khai. Khi dev, dùng tunnel:

```bash
cloudflared tunnel --url http://localhost:3000
```

1. Đặt `BASE_URL` trong `.env` bằng URL tunnel (không có `/` cuối), khởi động lại app.
2. **Claude**: Settings → Connectors → Add custom connector → URL `<BASE_URL>/mcp`.
3. **ChatGPT**: Settings → Apps & Connectors → Advanced → bật Developer mode → Create → MCP server URL `<BASE_URL>/mcp`, Authentication: OAuth.
4. Trình duyệt mở `/login` → đăng nhập/tạo tài khoản (email phải nằm trong `ALLOWED_EMAILS`) → `/consent` → Đồng ý.
5. Trong cuộc trò chuyện: "Gọi tool whoami".

## Vận hành

- Production đặt sau reverse proxy HTTPS; Postgres không mở ra internet; ổ đĩa và backup được mã hoá.
- `DATABASE_URL` dùng role `pf_app` (bị RLS); migration dùng `MIGRATION_DATABASE_URL` (role `pf_owner`).
````

- [ ] **Step 2: Chạy thật với tunnel**

```bash
bun run db:migrate
cloudflared tunnel --url http://localhost:3000   # terminal riêng; ghi lại https://<random>.trycloudflare.com
# sửa BASE_URL trong .env thành URL trên, rồi:
bun run start:dev
curl -s <BASE_URL>/.well-known/oauth-protected-resource/mcp
```

Expected: JSON có `resource = <BASE_URL>/mcp`.

- [ ] **Step 3: Connect Claude** theo README bước 2, 4, 5.

Expected: Claude hiển thị connector đã kết nối; gọi `whoami` trả `user_id` của bạn và scopes `finance:read`, `finance:write`.

- [ ] **Step 4: Connect ChatGPT** theo README bước 3, 4, 5.

Expected: như trên.

- [ ] **Step 5: Ghi nhận kết quả**

Nếu một client thất bại: ghi lại bước lỗi, request cuối cùng trong log app, và thông báo lỗi của client. Không đổi spec/plan tự ý — báo lại để quyết định (spec §9: cân nhắc `@better-auth/cimd`, `ipAddressHeaders` khi sau proxy, CORS cho MCP Inspector).

- [ ] **Step 6: Commit**

Stage `README.md`. Message:

```
docs: add setup, testing and connector instructions
```

---

## Hoàn tất Plan 1

Tiêu chí xong:
- `bun run test`, `bun run test:int`, `bun run test:e2e`, `bun run typecheck`, `bun run lint` đều pass.
- Claude và ChatGPT thật connect được và gọi `whoami` thành công (Task 12).

Sau đó viết Plan 2 (ledger + tool ghi/đọc giao dịch) dựa trên kết quả thực tế.
