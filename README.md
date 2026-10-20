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
