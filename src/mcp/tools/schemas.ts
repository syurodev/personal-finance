import { z } from 'zod';
import { ACCOUNT_TYPES, CATEGORY_KINDS, TRANSACTION_KINDS } from '../../db/schema/index.js';

// ---------- input ----------

export const amountInput = z
  .string()
  .describe('Số tiền dương dạng chuỗi, dấu chấm thập phân: "85000", "12.5". Đổi "85k" thành "85000", "2tr" thành "2000000".');
export const signedAmountInput = z
  .string()
  .describe('Số tiền dạng chuỗi, có thể âm (ví dụ dư nợ thẻ tín dụng "-2000000").');
export const entryType = z.enum(['expense', 'income']).describe('expense = khoản chi, income = khoản thu');
export const accountRef = z.string().describe('Id hoặc tên ví; không cần dấu, không phân biệt hoa thường');
export const categoryRef = z.string().describe('Id hoặc tên danh mục; không cần dấu, không phân biệt hoa thường');
export const dateInput = z.string().describe('Ngày dạng YYYY-MM-DD; bỏ trống = hôm nay theo múi giờ người dùng');

// ---------- output ----------

export const accountView = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.string(),
  balance: z.string(),
  archived: z.boolean(),
});

export const balanceView = z.object({
  account_id: z.string(),
  name: z.string(),
  currency: z.string(),
  balance: z.string(),
});

export const categoryView = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(CATEGORY_KINDS),
  parent_id: z.string().nullable(),
  archived: z.boolean(),
});

export const categoryNode = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(CATEGORY_KINDS),
  children: z.array(z.object({ id: z.string(), name: z.string() })),
});

const ref = z.object({ id: z.string(), name: z.string() });

export const transactionView = z.object({
  id: z.string(),
  kind: z.enum(TRANSACTION_KINDS),
  type: z.enum(['expense', 'income', 'transfer_out', 'transfer_in', 'adjustment']),
  amount: z.string(),
  signed_amount: z.string(),
  currency: z.string(),
  account: ref,
  category: ref.nullable(),
  occurred_on: z.string(),
  description: z.string().nullable(),
  merchant: z.string().nullable(),
  note: z.string().nullable(),
  transfer_group_id: z.string().nullable(),
  deleted: z.boolean(),
});

export const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
export const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
