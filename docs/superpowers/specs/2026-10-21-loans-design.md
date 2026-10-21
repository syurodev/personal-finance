# Khoản vay, trả góp và cho vay — Thiết kế bổ sung

Ngày: 2026-10-21 · Bổ sung cho `2026-10-20-personal-finance-mcp-design.md` · Phiên bản đích: 0.4.0

## 1. Mục tiêu

Agent trả lời được "còn nợ bao nhiêu, còn mấy kỳ", "tháng này phải trả gì", "tổng lãi phải trả",
ghi một kỳ trả bằng một lệnh (tự tách gốc/lãi), và xử lý trả trước hạn, lãi thả nổi.

**Ngoài phạm vi:** giao dịch định kỳ chung (tính năng F), nhắc hạn chủ động (server chỉ trả lời khi
được gọi — nhắc qua `instructions`, `get_overview` và prompt `month_end_review`), tính lãi theo số ngày
thực tế (người dùng nhập đè lãi thật khi ghi kỳ), phạt trả chậm.

## 2. Quyết định chính

| Chủ đề | Quyết định |
|---|---|
| Chiều | `borrow` (đi vay, trả góp) và `lend` (cho vay) |
| Cách tính | `equal_principal` (gốc đều, lãi trên dư nợ giảm dần), `annuity` (trả đều mỗi kỳ, dư nợ giảm dần), `flat` (lãi phẳng trên gốc ban đầu). Trả góp 0% = `flat` với `annual_rate = 0` |
| Lãi suất | `annual_rate` % năm, lãi kỳ = dư nợ (hoặc gốc ban đầu với `flat`) × rate / 1200, làm tròn half-up theo currency |
| Kỳ | Hằng tháng; kỳ đầu mặc định 1 tháng sau `start_date`; giữ ngày trong tháng, kẹp về ngày cuối tháng |
| Ví nợ | Mỗi khoản vay tự tạo một ví loại mới `loan` (cùng tên). Vay: số dư âm = dư nợ; cho vay: số dư dương = phải thu. `net_worth` tự phản ánh |
| Giải ngân | `cash` — chuyển khoản giữa ví nợ và ví nhận/chi tiền; `purchase` — mua hàng trả góp: một khoản chi trên ví nợ thuộc danh mục món hàng (báo cáo chi tiêu thấy ngay); `existing` — khoản vay đang chạy: nhập số kỳ đã trả, ví nợ mở với số dư = dư nợ còn lại, không tạo giao dịch |
| Ghi một kỳ | Gốc = chuyển khoản ví trả ↔ ví nợ; lãi = khoản chi (vay, danh mục "Lãi & phí vay") hoặc khoản thu (cho vay, "Lãi cho vay") — danh mục tự tạo khi cần. Gốc/lãi mặc định theo lịch, nhập đè được |
| Trả thêm gốc / lãi suất mới | Tính lại các kỳ chưa trả trên dư nợ mới, giữ số kỳ và ngày đến hạn (giảm tiền mỗi kỳ). Hết dư nợ → tất toán, xoá các kỳ còn lại |
| Bất biến | Dư nợ = tổng `principal_due` các kỳ `due` |
| An toàn đồng thời | Ghi kỳ / sửa / huỷ khoá dòng `loan` (`FOR UPDATE`) |
| Huỷ | Chỉ khi chưa ghi kỳ nào qua tool: xoá mềm giao dịch giải ngân, lưu trữ ví nợ, trạng thái `cancelled` |

## 3. Dữ liệu (RLS theo `user_id`, như các bảng khác)

```
ledger_account.type   + 'loan'

loan
  id, user_id, name, direction, method, principal numeric, currency, annual_rate numeric,
  term_months int, start_date, first_due_date, account_id → ledger_account (ví nợ),
  payment_account_id? → ledger_account, disbursement_transaction_id? → ledger_transaction,
  status ('active'|'closed'|'cancelled'), closed_at?, created_at, updated_at
  unique (user_id, lower(name)) where status = 'active'

loan_installment
  id, user_id, loan_id → loan (cascade), seq, due_date, principal_due, interest_due,
  status ('due'|'paid'), paid_on?, principal_paid?, interest_paid?,
  principal_transfer_group_id?, interest_transaction_id?, fee_transaction_id?
  unique (loan_id, seq)
```

Kỳ đã trả trước khi theo dõi (`existing`): `status = 'paid'`, không có giao dịch.

## 4. MCP tools (thêm 6, tổng 21)

| Tool | Scope | Mục đích |
|---|---|---|
| `create_loan` | write | Tạo khoản vay/trả góp/cho vay, ví nợ và lịch trả |
| `record_loan_payment` | write | Ghi kỳ kế tiếp: gốc + lãi (+ trả thêm gốc, phí), tất toán khi hết nợ |
| `update_loan` | write | Đổi tên, ví trả mặc định, lãi suất (tính lại kỳ chưa trả) |
| `cancel_loan` | write, destructive | Huỷ khoản vay tạo nhầm (chưa có kỳ nào được ghi) |
| `get_loan_status` | read | Tất cả khoản vay đang chạy, hoặc chi tiết một khoản kèm lịch trả |
| `list_upcoming_payments` | read | Các kỳ quá hạn và đến hạn trong N ngày, tổng theo currency/chiều |

`get_overview` thêm `debts` (tổng nợ/phải thu theo currency, kỳ gần nhất, số kỳ quá hạn; `null` nếu
không có khoản vay). `month_end_review` thêm bước `list_upcoming_payments`. Mã lỗi mới:
`LOAN_NOT_FOUND`, `AMBIGUOUS_LOAN`, `LOAN_CLOSED`, `LOAN_HAS_PAYMENTS`, `OVERPAYMENT`.
