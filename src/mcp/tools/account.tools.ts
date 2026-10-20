import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FINANCE_WRITE } from '../../auth/constants.js';
import { ACCOUNT_TYPES } from '../../db/schema/index.js';
import { createAccount, updateAccount } from '../../ledger/accounts.js';
import { runTool } from '../tool-kit.js';
import { accountRef, accountView, signedAmountInput, WRITE } from './schemas.js';

export function registerAccountTools(server: McpServer): void {
  server.registerTool(
    'create_account',
    {
      title: 'Tạo ví',
      description:
        'Tạo ví/tài khoản mới (tiền mặt, ngân hàng, thẻ tín dụng, ví điện tử). Chỉ gọi khi người dùng đồng ý tạo ví.',
      inputSchema: {
        type: z.enum(ACCOUNT_TYPES).describe('cash | bank | credit_card | ewallet'),
        name: z.string().describe('Tên ví, ví dụ "Vietcombank", "Momo"'),
        currency: z.string().optional().describe('Mã tiền tệ (VND, USD, …); mặc định là tiền tệ của người dùng'),
        opening_balance: signedAmountInput.optional().describe('Số dư ban đầu; thẻ tín dụng đang nợ thì để số âm'),
      },
      outputSchema: accountView.shape,
      annotations: WRITE,
    },
    async (args) =>
      runTool(
        FINANCE_WRITE,
        () =>
          createAccount({ type: args.type, name: args.name, currency: args.currency, openingBalance: args.opening_balance }),
        (a) => `Đã tạo ví "${a.name}" (${a.currency}), số dư ${a.balance}.`,
      ),
  );

  server.registerTool(
    'update_account',
    {
      title: 'Sửa ví',
      description: 'Đổi tên ví, lưu trữ (archived=true) hoặc mở lại (archived=false).',
      inputSchema: {
        account: accountRef,
        name: z.string().optional(),
        archived: z.boolean().optional(),
      },
      outputSchema: accountView.shape,
      annotations: WRITE,
    },
    async ({ account, name, archived }) =>
      runTool(
        FINANCE_WRITE,
        () => updateAccount(account, { name, archived }),
        (a) => `Đã cập nhật ví "${a.name}"${a.archived ? ' (đã lưu trữ)' : ''}.`,
      ),
  );
}
