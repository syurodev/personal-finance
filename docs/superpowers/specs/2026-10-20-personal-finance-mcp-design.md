# Personal Finance qua MCP — Thiết kế MVP

Ngày: 2026-10-20 · Trạng thái: chờ review

## 1. Mục tiêu và phạm vi

Web-app quản lý tài chính cá nhân **gần như không có UI**: người dùng thao tác hoàn toàn
qua agent (Claude, ChatGPT) bằng MCP. Sau khi connect connector một lần, mở Claude/ChatGPT
là ghi chép và truy vấn được ngay.

**Trong MVP**

- Ghi chép thu/chi bằng ngôn ngữ tự nhiên (agent phân loại và gọi tool).
- Nhiều ví/tài khoản: tiền mặt, ngân hàng, thẻ tín dụng, ví điện tử; chuyển khoản giữa ví; số dư.
- Ngân sách hằng tháng theo danh mục.
- Báo cáo/truy vấn: thu–chi–tiết kiệm, theo danh mục/ví/merchant/thời gian, so sánh kỳ trước.
- Đối soát số dư với thực tế.

**Ngoài MVP** (thiết kế không chặn đường làm sau): nhập hàng loạt (CSV/sao kê/ảnh hoá đơn),
giao dịch định kỳ, đầu tư/tài sản, đa tiền tệ có tỷ giá, mã hoá field (vault), chia sẻ dữ liệu
giữa các user, UI quản lý connector.

**Người dùng**: cá nhân trước, nhưng dữ liệu luôn gắn `user_id` nên nhiều user dùng độc lập
được. Đăng ký chỉ mở cho email trong allowlist.

## 2. Các quyết định chính

| Chủ đề | Quyết định | Lý do |
|---|---|---|
| Runtime / framework | Bun + NestJS 12, modular monolith | Một deploy; MCP tool gọi thẳng domain service |
| Auth | better-auth `emailAndPassword` + `@better-auth/oauth-provider` | Claude/ChatGPT cần OAuth 2.1 + DCR; plugin có sẵn |
| Access token | Opaque (`disableJwtPlugin: true`) | Revoke có hiệu lực ngay, không phải quản lý JWKS |
| DB | PostgreSQL + Drizzle ORM | Gần SQL, có adapter better-auth, hợp báo cáo |
| Cách ly dữ liệu | Postgres **Row Level Security** theo `app.user_id` | Chặn lỗi quên `WHERE user_id` ngay ở DB |
| Mã hoá field / vault | **Không làm trong MVP** | Dữ liệu là lịch sử tiêu dùng, không có STK/thẻ. Bảo vệ at-rest bằng mã hoá ổ đĩa + backup mã hoá. Sẽ thêm mã hoá riêng cho field nhạy cảm khi có |
| Kiểu tiền | Postgres `numeric` (không giới hạn precision) + `decimal.js` ở app | Chính xác tuyệt đối, không đổi đơn vị, mở đường cho crypto/tỷ giá |
| Giao tiếp tiền với agent | Chuỗi thập phân, luôn dương + `type` | Tự nhiên với LLM, tránh nhầm dấu |
| MCP transport | `@modelcontextprotocol/sdk` Streamable HTTP, stateless, trả JSON | Đơn giản, scale ngang được, đủ cho tool call |
| UI | 2 trang HTML render từ server: `/login`, `/consent` | Tối thiểu bắt buộc của OAuth |

Phiên bản tham chiếu (2026-10-20): better-auth 1.7.11, @better-auth/oauth-provider 1.7.11,
@modelcontextprotocol/sdk 1.32.1, drizzle-orm 0.45.4, decimal.js 10.6.0, Bun 1.4.3.

## 3. Kiến trúc

```
src/
  config/      đọc env, validate (DATABASE_URL, BETTER_AUTH_SECRET, BASE_URL, ALLOWED_EMAILS…)
  db/          Drizzle schema, migrations, DbService, RequestContext (AsyncLocalStorage)
  auth/        cấu hình better-auth, mount /api/auth/*, hook allowlist đăng ký
  pages/       /login, /consent (HTML server-render, CSS tối thiểu, không build frontend)
  well-known/  /.well-known/oauth-protected-resource, /.well-known/oauth-authorization-server
  mcp/         POST /mcp, McpAuthGuard, đăng ký tool/prompt, chuẩn hoá lỗi
  money/       Money value object, bảng currency → số chữ số thập phân
  ledger/      accounts, categories, transactions, transfers, reconcile, name resolver
  budgets/     hạn mức tháng, trạng thái ngân sách
  reports/     overview, cashflow summary (SQL tổng hợp)
  audit/       ghi audit_log cho thao tác ghi
```

Quy tắc phụ thuộc: `mcp` → `ledger`/`budgets`/`reports` → `db`/`money`. Domain service
không biết MCP tồn tại (nhận input đã parse, trả object thuần). `mcp` chỉ lo map
tham số ↔ service, scope, định dạng kết quả và lỗi.

## 4. Data model

### 4.1 Bảng better-auth

`user`, `session`, `account`, `verification`, `oauth_client`, `oauth_access_token`,
`oauth_refresh_token`, `oauth_consent` (sinh bởi better-auth CLI cho Drizzle).
`user` thêm `additionalFields`:

- `base_currency text not null default 'VND'`
- `timezone text not null default 'Asia/Ho_Chi_Minh'`

### 4.2 Bảng domain

ID là UUIDv7 kiểu `uuid`, default `uuidv7()` của PostgreSQL 18. `user_id` là `text` tham chiếu
`user.id`. Mọi bảng có `created_at`, `updated_at` (`timestamptz`).

```
ledger_account
  id, user_id, type ('cash'|'bank'|'credit_card'|'ewallet'), name, currency,
  opening_balance numeric not null default 0, archived_at timestamptz null
  unique (user_id, lower(name)) where archived_at is null

category
  id, user_id, parent_id uuid null → category, kind ('expense'|'income'), name,
  archived_at null
  unique (user_id, kind, parent_id, lower(name)) where archived_at is null

ledger_transaction   (tránh từ khoá SQL `transaction`)
  id, user_id, account_id → ledger_account,
  kind ('standard'|'transfer'|'adjustment'),
  category_id null → category,      -- chỉ cho kind='standard'
  amount numeric not null,          -- có dấu: âm = tiền ra khỏi ví
  currency,                         -- luôn = currency của ví
  occurred_on date not null,
  transfer_group_id uuid null,      -- 2 dòng của một lần chuyển khoản dùng chung
  description text null, merchant text null, note text null,
  source_client_id text null,       -- OAuth client đã ghi (Claude/ChatGPT)
  deleted_at timestamptz null
  index (user_id, occurred_on), (user_id, account_id, occurred_on), (user_id, category_id, occurred_on)

budget
  id, user_id, category_id → category (kind='expense'),
  amount numeric null,              -- null = bỏ hạn mức từ tháng này
  currency, effective_from char(7)  -- 'YYYY-MM'
  unique (user_id, category_id, effective_from)

audit_log
  id, user_id, actor_client_id, action, entity, entity_id, at
```

### 4.3 Quy tắc dữ liệu

- **Số dư ví** tại ngày D = `opening_balance + SUM(amount)` với `occurred_on <= D` và
  `deleted_at is null`. Tính khi cần, không lưu.
- **Thẻ tín dụng**: chi tiêu làm số dư âm (dư nợ); trả thẻ = chuyển khoản vào ví thẻ.
- **Chuyển khoản**: 2 dòng `kind='transfer'` cùng `transfer_group_id`, tổng = 0. MVP từ chối
  chuyển giữa 2 ví khác currency. Phí chuyển (nếu có) là một dòng `standard` riêng.
- **Điều chỉnh** (`kind='adjustment'`): sinh bởi đối soát số dư, không có danh mục.
- **Báo cáo thu/chi** chỉ tính `kind='standard'`. Transfer và adjustment ảnh hưởng số dư
  nhưng không phải thu/chi.
- **Dấu và danh mục**: dòng `standard` có `amount < 0` chỉ gắn danh mục `expense`,
  `amount > 0` chỉ gắn danh mục `income`. `amount = 0` bị từ chối.
- **Currency hỗ trợ trong MVP** và số chữ số thập phân (ISO 4217): VND 0, USD 2, EUR 2,
  JPY 0, SGD 2, THB 2. Số có nhiều chữ số thập phân hơn → `INVALID_AMOUNT_SCALE`.
- **Ngân sách** tháng M của một danh mục = dòng `budget` có `effective_from <= M` lớn nhất;
  `amount null` nghĩa là không có hạn mức. Đã chi = tổng `-amount` của giao dịch `standard`
  thuộc danh mục đó **và các danh mục con** trong tháng M (theo timezone user).
- **Không quy đổi tiền tệ trong MVP**: mọi phép tổng hợp (tổng tài sản, cashflow, nhóm,
  so sánh kỳ) tách riêng theo `currency`; không bao giờ cộng hai currency với nhau.
  Ngân sách có `currency` = `user.base_currency` và chỉ tính giao dịch cùng currency.
- **Danh mục tối đa 2 cấp**: danh mục cha phải là danh mục cấp 1 cùng `kind`.
- **Danh mục mặc định** seed khi tạo user (hook `databaseHooks.user.create.after`;
  user có từ trước dùng `bun run db:seed-categories`):
  chi — Ăn uống, Đi lại, Nhà ở, Hoá đơn & tiện ích, Mua sắm, Giải trí, Sức khoẻ, Giáo dục,
  Gia đình, Quà tặng & từ thiện, Khác; thu — Lương, Thưởng, Lãi & đầu tư, Thu khác.
- **Xoá** là xoá mềm (`deleted_at`). Xoá một dòng transfer xoá cả cặp.

### 4.4 Row Level Security

- Hai role Postgres: `pf_owner` (sở hữu bảng, chạy migration) và `pf_app` (runtime).
- Bảng domain: `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy cho `pf_app`:
  `user_id = current_setting('app.user_id', true)` cho cả `USING` và `WITH CHECK`.
  Không có `app.user_id` → không thấy/không ghi được dòng nào (fail closed).
- Bảng better-auth **không** bật RLS (auth cần tra cứu chéo user); `pf_app` có quyền trên chúng.
- Mỗi request đã xác thực chạy trong một transaction:
  `select set_config('app.user_id', $userId, true)` rồi mới chạy truy vấn. Transaction và
  `userId`, `clientId`, `scopes` được giữ trong `AsyncLocalStorage` (`RequestContext`);
  repository luôn lấy `tx` từ đó.
- Repository **vẫn** lọc `user_id` tường minh; RLS là lớp phòng thủ thứ hai.

## 5. Auth và luồng connect MCP

### 5.1 Cấu hình better-auth

- `emailAndPassword: { enabled: true }`. Hook `before` trên `/sign-up/email`: email phải
  nằm trong `ALLOWED_EMAILS` (danh sách phân tách bằng dấu phẩy), nếu không → 403.
  Hook `after` khi tạo user: seed danh mục mặc định.
- `oauthProvider({ … })`:
  - `loginPage: '/login'`, `consentPage: '/consent'`
  - `scopes: ['offline_access','finance:read','finance:write']` (không dùng OIDC/`openid`)
  - `allowDynamicClientRegistration: true` + `allowUnauthenticatedClientRegistration: true`
    (Claude/ChatGPT tự đăng ký client công khai + PKCE; vẫn cần user login + consent)
  - `disableJwtPlugin: true`, `resources: [{ identifier: '<BASE_URL>/mcp' }]`,
    `clientRegistrationDefaultResources: ['<BASE_URL>/mcp']`
  - access token 1 giờ, refresh token 90 ngày; nới rate limit `/register` và `/token`
    (Claude/ChatGPT gọi từ IP dùng chung)
- Issuer = `<BASE_URL>/api/auth`.
- Handler better-auth mount tại `/api/auth/*` **trước** body parser của Nest.

### 5.2 Discovery

- `GET /.well-known/oauth-protected-resource/mcp` (RFC 9728, kèm bản không hậu tố):
  `resource = <BASE_URL>/mcp`, `authorization_servers = [<BASE_URL>/api/auth]`,
  `scopes_supported = ['offline_access','finance:read','finance:write']`.
- `GET /.well-known/oauth-authorization-server/api/auth` (RFC 8414, kèm bản không hậu tố):
  metadata từ `auth.api.getOAuthServerConfig()`.
- `/mcp` không có token hoặc token không hợp lệ → `401` +
  `WWW-Authenticate: Bearer resource_metadata="<BASE_URL>/.well-known/oauth-protected-resource/mcp"`.

### 5.3 Trang HTML

- `/login`: form email/password → `POST /api/auth/sign-in/email` kèm `oauth_query` = nguyên
  query đã ký mà oauth-provider truyền sang → response `{ redirect, url }` → chuyển trang. Không có link đăng ký công khai; nếu email
  thuộc allowlist mà chưa có tài khoản thì form có chế độ "tạo tài khoản".
- `/consent`: hiển thị tên client và scope bằng tiếng Việt ("Xem dữ liệu tài chính",
  "Ghi/sửa dữ liệu tài chính") → Đồng ý / Từ chối gọi `POST /api/auth/oauth2/consent`
  `{ accept, oauth_query }`.
- Escape mọi giá trị động (tên client do bên ngoài đăng ký). Header CSP chặt, không JS bên
  thứ ba.

### 5.4 Vòng đời request MCP

```
POST /mcp  Authorization: Bearer <token>
 → McpAuthService: getOAuthProviderApi(...).requireActiveAccessToken(token)
     → { sub=userId, scope, client_id, aud } (aud nếu có phải = <BASE_URL>/mcp)
 → DbService.transaction: set_config('app.user_id', userId, true)
 → RequestContext.run({ tx, userId, clientId, scopes, timezone, baseCurrency })
 → McpServer + StreamableHTTPServerTransport (stateless, enableJsonResponse) xử lý message
 → tool handler: kiểm tra scope → gọi domain service
 → commit (hoặc rollback khi có lỗi)
GET/DELETE /mcp → 405
```

Revoke connector trong MVP: gỡ trong Claude/ChatGPT; token hết hạn tự nhiên hoặc xoá trong DB.

## 6. MCP tools

### 6.1 Quy ước chung

- **Tham chiếu ví/danh mục** nhận id hoặc tên. Chuẩn hoá tên: NFD, bỏ dấu, `đ→d`, lowercase,
  trim, gộp khoảng trắng. Thứ tự khớp: UUID → khớp chính xác → duy nhất bắt đầu bằng →
  duy nhất chứa. Nhiều kết quả → `AMBIGUOUS_*` kèm ứng viên; không có → `*_NOT_FOUND` kèm
  tối đa 5 gợi ý gần nhất. Không tự tạo ví/danh mục.
- **Số tiền**: chuỗi thập phân dương (`"85000"`, `"12.34"`); chiều do `type`. Kết quả trả
  về số tiền dạng chuỗi kèm `currency`.
- **Ngày**: `YYYY-MM-DD`; mặc định hôm nay theo `user.timezone`. "Tháng" = `YYYY-MM`.
- **Kết quả**: `structuredContent` (có `outputSchema`) + một dòng text tóm tắt tiếng Việt.
- **Annotations**: tool đọc `readOnlyHint: true`; `delete_transaction` `destructiveHint: true`.
- **Scope**: tool đọc cần `finance:read`; tool ghi cần `finance:write`.
- **Server `instructions`**: gọi `get_overview` ở đầu cuộc hội thoại; chi tiêu bằng thẻ tín
  dụng ghi vào ví thẻ, trả thẻ là chuyển khoản; hỏi lại user khi gặp `AMBIGUOUS_*`.

### 6.2 Danh sách tool

| # | Tool | Scope | Input chính | Output chính |
|---|---|---|---|---|
| 1 | `get_overview` | read | `as_of?` | `today`, `timezone`, `base_currency`, ví (id, tên, loại, currency, số dư tại `as_of`), tổng tài sản theo currency, cây danh mục, tóm tắt ngân sách tháng chứa `as_of` |
| 2 | `record_transactions` | write | `items[1..50]`: `amount, type (expense\|income), account, category?, occurred_on?, description?, merchant?, note?` | id từng dòng, số dư mới của các ví bị ảnh hưởng. Cả batch là một transaction: một dòng lỗi → không ghi gì, lỗi chỉ rõ index |
| 3 | `record_transfer` | write | `from_account, to_account, amount, occurred_on?, note?, fee?, fee_category?` | `transfer_group_id`, số dư mới 2 ví |
| 4 | `update_transaction` | write | `id` + các field cần sửa (`amount, type, account, category, occurred_on, description, merchant, note`) | dòng sau khi sửa. Dòng transfer chỉ sửa được `amount, occurred_on, note` và áp cho cả cặp |
| 5 | `delete_transaction` | write | `id, restore?` | trạng thái mới; transfer xoá/khôi phục cả cặp |
| 6 | `search_transactions` | read | `from?, to?, account?, category? (gồm con), type?, kind?, min_amount?, max_amount?, text?, sort (date_desc\|date_asc\|amount_desc\|amount_asc), limit≤200, cursor?, include_deleted?` | danh sách + `next_cursor` (phân trang offset) + `total_count` + `totals[{currency, count, inflow, outflow}]` của toàn bộ kết quả |
| 7 | `create_account` | write | `type, name, currency?, opening_balance?` | ví mới |
| 8 | `update_account` | write | `account, name?, archived?` | ví sau khi sửa |
| 9 | `create_category` | write | `name, kind, parent?` | danh mục mới |
| 10 | `update_category` | write | `category, name?, parent?, archived?` | danh mục sau khi sửa |
| 11 | `set_budget` | write | `category, amount \| null, from_month?` | hạn mức hiệu lực |
| 12 | `get_budget_status` | read | `month?` | mỗi danh mục có hạn mức: `limit, spent, remaining, percent, status (ok\|warning ≥80%\|over)`; `days_in_month`, `days_elapsed`; tổng (không cộng trùng danh mục con khi cha cũng có hạn mức) |
| 13 | `cashflow_summary` | read | `from, to, type (expense\|income\|all, mặc định all), group_by (category\|account\|merchant\|month\|week\|day)?, compare_previous?` | theo từng currency: `totals {income, expense, net, savings_rate, count}`, `groups[]` (danh mục gộp về cấp 1), `previous` + `comparison {income_change, expense_change, net_change}` nếu bật (khoảng phủ trọn tháng → các tháng liền trước; khoảng bất kỳ → cùng số ngày) |
| 14 | `reconcile_account` | write | `account, actual_balance, as_of?` | số dư trước, chênh lệch, dòng `adjustment` (không tạo nếu chênh lệch = 0); khoá dòng ví (`FOR UPDATE`) nên gọi song song không tạo trùng |

`text` trong `search_transactions` tìm `ILIKE` trên `description`, `merchant`, `note` (có
`unaccent`). `group_by: merchant` gom theo merchant đã chuẩn hoá; dòng không có merchant vào
nhóm "(không rõ)". `savings_rate = net / income` (null nếu income = 0).

### 6.3 Prompt

`month_end_review(month?)` (mặc định: tháng trước nếu đang ở 7 ngày đầu tháng, ngược lại tháng này): kịch bản tổng kết tháng — hỏi user số dư thực tế từng ví và gọi
`reconcile_account` → `cashflow_summary` (group_by category, compare_previous) →
`get_budget_status` → `get_overview` đầu và cuối tháng → nhận xét và gợi ý.

### 6.4 Lỗi

Lỗi nghiệp vụ trả `isError: true`, `content[0].text` là JSON `{ code, message, details? }`,
message tiếng Việt chỉ cách sửa. Không gửi `structuredContent` khi lỗi (client SDK kiểm tra
nó theo `outputSchema` kể cả khi `isError`). Mỗi lần gọi tool ghi chạy trong savepoint riêng
để lỗi giữa chừng không để lại ghi dở. Mã lỗi:

`ACCOUNT_NOT_FOUND`, `AMBIGUOUS_ACCOUNT`, `CATEGORY_NOT_FOUND`, `AMBIGUOUS_CATEGORY`,
`CATEGORY_KIND_MISMATCH`, `CURRENCY_MISMATCH`, `UNSUPPORTED_CURRENCY`,
`INVALID_AMOUNT`, `INVALID_AMOUNT_SCALE`, `INVALID_DATE_RANGE`, `TRANSACTION_NOT_FOUND`,
`ACCOUNT_ARCHIVED`, `SAME_ACCOUNT_TRANSFER`, `INSUFFICIENT_SCOPE`, `VALIDATION_ERROR`,
`DUPLICATE_NAME`, `INTERNAL_ERROR` (kèm `details.ref` để tra log).

Lỗi hệ thống (DB, bug) → log đầy đủ ở server kèm request id; agent nhận `INTERNAL_ERROR`
và request id, không lộ chi tiết.

## 7. Audit

Mỗi thao tác ghi thành công thêm `audit_log` (action dạng `transaction.create`,
`account.reconcile`…, entity, entity_id, client id) trong cùng transaction. Không lưu payload.

## 8. Testing

- **Unit** (vitest): `Money` (parse, kiểm tra scale theo currency, cộng/so sánh, format);
  chuẩn hoá tên và resolver; tính khoảng thời gian theo timezone (đầu/cuối tháng, tuần, kỳ
  trước cùng độ dài); quy tắc dấu/danh mục.
- **Integration** (vitest + Postgres thật qua Docker): repository và service; **RLS cách
  ly** (user A không đọc/ghi được dữ liệu user B kể cả khi bỏ `WHERE user_id`; thiếu
  `app.user_id` → 0 dòng); số dư, transfer, reconcile, budget có danh mục con, cashflow và
  compare_previous.
- **E2E** (Nest app thật + Postgres): luồng OAuth đầy đủ bằng code (DCR → login → authorize →
  consent → token với PKCE) rồi dùng MCP client của SDK gọi từng tool qua HTTP; `401` +
  `WWW-Authenticate` khi thiếu token; token chỉ có `finance:read` bị từ chối ở tool ghi.
- **Chấp nhận thủ công**: connect Claude (custom connector) và ChatGPT qua HTTPS (tunnel khi
  dev), chạy kịch bản một tháng: nhận lương → chi tiêu → rút ATM → quẹt và trả thẻ → sửa
  khoản nhầm → xem ngân sách → `month_end_review`.

## 9. Rủi ro cần xác minh sớm (spike đầu tiên)

1. better-auth + oauth-provider mount trong NestJS 12 chạy trên Bun (thứ tự body parser,
   ESM, decorator metadata).
2. Claude và ChatGPT connect được end-to-end với DCR + discovery + token opaque của
   oauth-provider 1.7.11 (dùng một tool `ping` tạm).
3. `set_config(..., true)` trong transaction hoạt động đúng với pool kết nối của driver đã
   chọn và Drizzle transaction.

Spike thất bại ở (1) → tách better-auth thành handler riêng trong cùng process Bun
trước Nest. Thất bại ở (2) → đánh giá thêm plugin `@better-auth/cimd` hoặc điều chỉnh
cấu hình theo lỗi thực tế.

## 10. Vận hành

- `compose.yaml`: Postgres 18 (dev/test); app chạy bằng `bun src/main.ts`. Production đặt sau reverse proxy HTTPS (bắt buộc với
  connector Claude/ChatGPT).
- Postgres không mở ra internet; ổ đĩa mã hoá; backup mã hoá (ví dụ pgBackRest `repo-cipher`).
- Biến môi trường: `DATABASE_URL` (role `pf_app`), `MIGRATION_DATABASE_URL` (role `pf_owner`),
  `BETTER_AUTH_SECRET`, `BASE_URL`, `ALLOWED_EMAILS`, `PORT`.

### Phiên bản và tương thích MCP tool

- Agent không đọc changelog: mỗi lần kết nối client gọi `tools/list` và làm theo mô tả, schema,
  `instructions` hiện tại. `CHANGELOG.md` dành cho người.
- `serverInfo.version` = `package.json` `version` (SemVer). Mỗi bản phát hành cập nhật `CHANGELOG.md`.
- Không đổi tên/xoá tool, không đổi tên hoặc thêm tham số **bắt buộc**, không đổi nghĩa/xoá trường output.
  Thêm tool, tham số tuỳ chọn, trường output mới là thay đổi tương thích (minor).
- Bắt buộc phá vỡ: giữ tool/tham số cũ làm alias ít nhất một minor, trả lỗi `DEPRECATED` có message chỉ
  tool thay thế khi hết hạn, rồi mới xoá ở major tiếp theo. Lịch sử chat cũ có thể còn gọi tên cũ.
- Server stateless không gửi `notifications/tools/list_changed`; sau khi phát hành, ghi trong changelog
  cách client lấy lại danh sách tool. App đã lên store ChatGPT phải nộp lại khi metadata tool đổi.
