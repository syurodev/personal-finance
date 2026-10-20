# Changelog

Lịch sử thay đổi cho người đọc (không gửi cho agent: agent đọc mô tả tool hiện tại qua `tools/list`).
Định dạng theo [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); phiên bản theo
[SemVer](https://semver.org/) và khớp `serverInfo.version` của MCP server.

Quy tắc tương thích cho MCP tool: xem spec §10 (`docs/superpowers/specs/2026-10-20-personal-finance-mcp-design.md`).

## [Unreleased]

## [0.2.0] - 2026-10-20

Ledger: agent quản lý ví, danh mục và giao dịch qua MCP.

### Added
- 11 MCP tool mới: `get_overview`, `create_account`, `update_account`, `create_category`,
  `update_category`, `record_transactions`, `record_transfer`, `update_transaction`,
  `delete_transaction`, `search_transactions`, `reconcile_account`.
- Bảng `ledger_account`, `category`, `ledger_transaction` với Row Level Security theo user;
  extension `unaccent` cho tìm kiếm không dấu.
- Danh mục mặc định (11 chi, 4 thu) tạo khi đăng ký; `bun run db:seed-categories` cho user có từ trước.
- Số tiền dùng `numeric` + `decimal.js`, kiểm tra số chữ số thập phân theo tiền tệ (VND, USD, EUR, JPY, SGD, THB).
- Tìm ví/danh mục theo tên không dấu; lỗi `AMBIGUOUS_*` / `*_NOT_FOUND` kèm ứng viên và gợi ý.
- `bun run test:e2e:bun`: chạy bộ e2e trên runtime Bun.

### Changed
- Tool ghi chạy trong savepoint riêng; lỗi giữa chừng không để lại dữ liệu ghi dở.
- Lỗi không phải lỗi nghiệp vụ trả `INTERNAL_ERROR` kèm `details.ref` thay vì lộ thông điệp hệ thống.
- `instructions` của MCP server hướng dẫn agent gọi `get_overview` đầu cuộc trò chuyện và quy ước số tiền.

### Migration
- `bun run db:migrate` (thêm migration `0003_ledger`, `0004_ledger_rls`), sau đó `bun run db:seed-categories`.
- Client cần lấy lại danh sách tool: Claude — mở cuộc trò chuyện mới; ChatGPT — refresh/scan lại MCP server.

## [0.1.0] - 2026-10-20

Nền tảng: Claude/ChatGPT kết nối được qua OAuth 2.1.

### Added
- NestJS 12 trên Bun; PostgreSQL 18 qua Docker với role `pf_owner` (migration) và `pf_app` (runtime, bị RLS).
- better-auth (email/password, đăng ký theo allowlist) + `@better-auth/oauth-provider`: đăng ký client động,
  PKCE, access token opaque, refresh token.
- Discovery `/.well-known/oauth-protected-resource[/mcp]` và `/.well-known/oauth-authorization-server[/api/auth]`.
- Trang `/login` và `/consent` (HTML tĩnh, CSP chặt).
- Endpoint MCP stateless `POST /mcp`, tool `whoami`; bảng `audit_log` có RLS.
- Log mỗi request (không ghi token hay query string OAuth).
