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

Nếu `bun run db:up` báo `error getting credentials` (Docker Desktop đặt `credsStore: "desktop"`), kéo image trước với cấu hình Docker tạm:
`DOCKER_CONFIG=$(mktemp -d) docker pull postgres:18`.

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

URL quick tunnel đổi mỗi lần chạy `cloudflared`; khi đổi phải cập nhật `BASE_URL` và connect lại.

## Vận hành

- Production đặt sau reverse proxy HTTPS; Postgres không mở ra internet; ổ đĩa và backup được mã hoá.
- `DATABASE_URL` dùng role `pf_app` (bị RLS); migration dùng `MIGRATION_DATABASE_URL` (role `pf_owner`).

## Deploy (server + ArgoCD)

Pipeline một file duy nhất: `.github/workflows/ci.yml`.

- **PR & push (mọi branch)**: Postgres service chạy với init SQL `docker/postgres/init`
  (tạo `pf_owner`/`pf_app`), chạy `typecheck` → `lint` → `test` → `test:int` → `test:e2e`.
- **Push lên main (sau khi test xanh)**: build `Dockerfile` → push
  `ghcr.io/syurodev/personal-finance:sha-<commit>` (GHCR, dùng `GITHUB_TOKEN`)
  → commit tag đó vào manifest `personal-finance/dev/server` của repo
  [syurodev/workload](https://github.com/syurodev/workload).

ArgoCD theo dõi workload repo (ApplicationSet `personal-finance-services-dev`,
namespace `personal-finance` trên cluster): mỗi lần tag được pin, PreSync
Migration Job chạy `bun src/db/migrate-cli.ts` với `MIGRATION_DATABASE_URL`
(role `pf_owner`), rồi Deployment pf-server rollout bằng `DATABASE_URL`
(role `pf_app`). Secrets lấy từ Infisical qua External Secrets — chi tiết
bootstrap và các key cần tạo xem `personal-finance/README.md` trong workload
repo.

**Một lần cấu hình**: thêm secret repo `WORKLOAD_REPO_TOKEN` (PAT có
`contents:write` trên `syurodev/workload`) vào repo này.

CI ghim Bun theo `packageManager` trong `package.json` (cùng phiên bản với
Dockerfile), và dùng Node 24 để chạy Vitest. Mỗi PR/push còn build image
`linux/amd64`, chạy migration trên database test riêng và kiểm tra `/healthz`
với filesystem read-only, user `10001`, không cấp Linux capabilities.

Job publish GHCR chỉ chạy từ `main` sau khi các kiểm tra đều qua. Job `update-workload`
bỏ qua revision cũ nếu `main` đã tiến thêm commit, và thử cập nhật workload
tối đa 3 lần khi có push đồng thời. Có thể chạy lại bằng `workflow_dispatch`
trên `main` sau khi sửa cấu hình Actions secret. Infisical được ESO đọc lúc
chạy trên cluster; CI không cần credential database production hay token
Infisical.

`update-workload` chỉ commit tag image mới vào Git; không kết nối Kubernetes
và không chạy `kubectl apply`. Argo CD theo dõi commit đó để thực hiện migration
và rollout trên cluster. Vì vậy token CI chỉ cần quyền ghi repo workload,
không cần kubeconfig hay quyền truy cập VPS. Kustomize được tải từ release
chính thức của `kubernetes-sigs/kustomize` và kiểm tra SHA-256 trước khi chạy.
