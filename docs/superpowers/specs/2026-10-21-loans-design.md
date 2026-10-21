# Khoản vay, trả góp và cho vay — Thiết kế bổ sung

Ngày: 2026-10-21 · Bổ sung cho `2026-10-20-personal-finance-mcp-design.md` · Phiên bản đích: 0.4.0

## 1. Mục tiêu

Agent trả lời được "còn nợ bao nhiêu, còn mấy kỳ", "tháng này phải trả gì", ghi một kỳ trả bằng một
lệnh, và xử lý trả dư/thiếu, tất toán sớm, ngân hàng đổi số tiền kỳ.

**Nguyên tắc: chỉ quản lý số tiền phải trả mỗi kỳ (đã gồm lãi).** Không có lãi suất, không tách
gốc/lãi theo kỳ. Chi phí vay (tổng phải trả − tiền thực nhận) được ghi **một lần** thành khoản chi để
tổng tài sản và báo cáo chi tiêu đúng.

**Ngoài phạm vi:** lãi suất và cách tính lãi, tách gốc/lãi từng kỳ, ước tính tiết kiệm khi trả trước,
giao dịch định kỳ chung (tính năng F), nhắc hạn chủ động (server chỉ trả lời khi được gọi — nhắc qua
`instructions`, `get_overview` và prompt `month_end_review`), phạt trả chậm.

## 2. Quyết định chính

| Chủ đề | Quyết định |
|---|---|
| Chiều | `borrow` (đi vay, trả góp) và `lend` (cho vay) |
| Khai báo | `installment_amount` (tiền mỗi kỳ) **hoặc** `total_payable` (tổng phải trả, chia đều, kỳ cuối nhận phần lẻ) + `term_months` + ngày kỳ đầu |
| Kỳ | Hằng tháng; kỳ đầu mặc định 1 tháng sau `start_date`; giữ ngày trong tháng, kẹp về ngày cuối tháng |
| Ví nợ | Mỗi khoản vay tự tạo một ví loại mới `loan` (cùng tên). Bất biến: số dư ví nợ = −(tổng các kỳ chưa trả) với vay, + với cho vay |
| Giải ngân `cash` | Chuyển `cash_amount` (tiền thực nhận/thực đưa, mặc định = tổng phải trả) giữa ví nợ và `disbursement_account`; phần chênh lệch → một khoản chi "Lãi & phí vay" (vay) hoặc khoản thu "Lãi cho vay" (cho vay) trên ví nợ |
| Giải ngân `purchase` | Mua hàng trả góp: một khoản chi bằng tổng phải trả trên ví nợ, thuộc danh mục món hàng |
| Giải ngân `existing` | Khoản vay đang chạy: nhập số kỳ đã trả; ví nợ mở với số dư = phần còn phải trả, không tạo giao dịch |
| Ghi một kỳ | Một chuyển khoản ví trả ↔ ví nợ; số tiền mặc định = tiền kỳ |
| Trả dư | Phần dư trừ dần vào các kỳ **cuối** (kỳ về 0 thì bỏ) → số kỳ còn lại giảm |
| Trả thiếu | Phần thiếu cộng vào kỳ kế tiếp (không còn kỳ nào thì thêm một kỳ tháng sau) |
| Tất toán sớm (`payoff`) | Trả số tiền thực tế; phần được miễn ghi thành dòng `adjustment` trên ví nợ; đóng khoản vay |
| Đổi tiền kỳ (lãi thả nổi) | Mọi kỳ chưa trả lấy số tiền mới; chênh lệch tổng → khoản chi/thu "Lãi & phí vay"/"Lãi cho vay" nếu tăng, `adjustment` nếu giảm |
| An toàn đồng thời | Ghi kỳ / sửa / huỷ khoá dòng `loan` (`FOR UPDATE`) |
| Huỷ | Chỉ khi chưa ghi kỳ nào qua tool: xoá mềm giao dịch giải ngân và chi phí, lưu trữ ví nợ, trạng thái `cancelled` |

## 3. Dữ liệu (RLS theo `user_id`, như các bảng khác)

```
ledger_account.type   + 'loan'

loan
  id, user_id, name, direction, total_payable numeric, currency, term_months int,
  start_date, first_due_date, account_id → ledger_account (ví nợ),
  payment_account_id? → ledger_account, disbursement_transaction_id?, cost_transaction_id? → ledger_transaction,
  status ('active'|'closed'|'cancelled'), closed_at?, created_at, updated_at
  unique (user_id, lower(name)) where status = 'active'

loan_installment
  id, user_id, loan_id → loan (cascade), seq, due_date, amount_due numeric (> 0),
  status ('due'|'paid'), paid_on?, amount_paid?, transfer_group_id?
  unique (loan_id, seq)
```

Kỳ đã trả trước khi theo dõi (`existing`): `status = 'paid'`, không có `transfer_group_id`.

## 4. MCP tools (thêm 6, tổng 21)

| Tool | Scope | Mục đích |
|---|---|---|
| `create_loan` | write | Tạo khoản vay/trả góp/cho vay, ví nợ và lịch trả |
| `record_loan_payment` | write | Ghi kỳ kế tiếp (mặc định đúng tiền kỳ; trả dư/thiếu; `payoff` để tất toán) |
| `update_loan` | write | Đổi tên, ví trả mặc định, tiền mỗi kỳ từ kỳ tới |
| `cancel_loan` | write, destructive | Huỷ khoản vay tạo nhầm (chưa có kỳ nào được ghi) |
| `get_loan_status` | read | Tất cả khoản vay đang chạy, hoặc chi tiết một khoản kèm lịch trả |
| `list_upcoming_payments` | read | Các kỳ quá hạn và đến hạn trong N ngày, tổng theo currency/chiều |

`get_overview` thêm `debts` (tổng nợ/phải thu theo currency, kỳ gần nhất, số kỳ quá hạn; `null` nếu
không có khoản vay). `month_end_review` thêm bước `list_upcoming_payments`. Mã lỗi mới:
`LOAN_NOT_FOUND`, `AMBIGUOUS_LOAN`, `LOAN_CLOSED`, `LOAN_HAS_PAYMENTS`, `OVERPAYMENT`.
