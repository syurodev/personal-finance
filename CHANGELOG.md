# Changelog

Lịch sử thay đổi cho người đọc (không gửi cho agent: agent đọc mô tả tool hiện tại qua `tools/list`).
Định dạng theo [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); phiên bản theo
[SemVer](https://semver.org/) và khớp `serverInfo.version` của MCP server.

Quy tắc tương thích cho MCP tool: xem spec §10 (`docs/superpowers/specs/2026-10-20-personal-finance-mcp-design.md`).

## [Unreleased]

## [0.4.0] - 2026-10-21

Khoản vay, trả góp và cho vay — theo dõi theo số tiền mỗi kỳ (đã gồm lãi).

### Added
- MCP tool `create_loan`, `record_loan_payment`, `update_loan`, `cancel_loan`, `get_loan_status`, `list_upcoming_payments`.
- Khai báo bằng tiền mỗi kỳ hoặc tổng phải trả; giải ngân `cash` (chênh lệch với tiền thực nhận ghi một lần là "Lãi & phí vay"), `purchase` (mua hàng trả góp, tính vào chi tiêu theo danh mục) hoặc `existing` (khoản vay đang chạy).
- Trả dư trừ vào các kỳ cuối, trả thiếu cộng vào kỳ sau, tất toán sớm có miễn giảm, đổi tiền kỳ khi ngân hàng đổi lãi suất.
- Loại ví `loan` (ví nợ tự tạo); danh mục hệ thống "Lãi & phí vay", "Lãi cho vay" tự tạo khi cần.
- `get_overview` có thêm trường `debts`; prompt `month_end_review` nhắc các kỳ trả sắp đến hạn.

### Migration
- `bun run db:migrate` (thêm `0007_loans`, `0008_loans_rls`).
- Client lấy lại danh sách tool: Claude — cuộc trò chuyện mới; ChatGPT — refresh/scan lại MCP server.

## [0.3.0] - 2026-10-20

Ngân sách, báo cáo thu chi và kịch bản tổng kết tháng.

### Added
- MCP tool `set_budget`, `get_budget_status`, `cashflow_summary`.
- MCP prompt `month_end_review` (đối soát → thu chi so với tháng trước → ngân sách → khoản chi lớn → nhận xét).
- Bảng `budget` (RLS): hạn mức tháng theo danh mục chi, áp dụng từ một tháng cho tới khi đặt lại; danh mục con tính vào danh mục cha.
- `get_overview` có thêm trường `budget` (tóm tắt ngân sách tháng chứa `as_of`, `null` nếu chưa đặt).

### Fixed
- `reconcile_account` khoá dòng ví khi đối soát: gọi song song không còn tạo nhiều dòng điều chỉnh.

### Migration
- `bun run db:migrate` (thêm `0005_budget`, `0006_budget_rls`).
- Client lấy lại danh sách tool: Claude — cuộc trò chuyện mới; ChatGPT — refresh/scan lại MCP server.

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
