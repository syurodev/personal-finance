import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FINANCE_WRITE } from '../../auth/constants.js';
import { reconcileAccount } from '../../ledger/transactions.js';
import { runTool } from '../tool-kit.js';
import { accountRef, dateInput, signedAmountInput, transactionView, WRITE } from './schemas.js';

export function registerReconcileTool(server: McpServer): void {
  server.registerTool(
    'reconcile_account',
    {
      title: 'Đối soát số dư',
      description:
        'Khớp số dư ví với số dư thực tế người dùng báo. Tạo một dòng điều chỉnh cho phần chênh lệch (không tính vào thu/chi); không tạo gì nếu đã khớp.',
      inputSchema: {
        account: accountRef,
        actual_balance: signedAmountInput,
        as_of: dateInput.optional(),
      },
      outputSchema: {
        account: z.object({ id: z.string(), name: z.string(), currency: z.string() }),
        as_of: z.string(),
        previous_balance: z.string(),
        actual_balance: z.string(),
        difference: z.string(),
        adjustment: transactionView.nullable(),
      },
      annotations: WRITE,
    },
    async ({ account, actual_balance, as_of }) =>
      runTool(
        FINANCE_WRITE,
        () => reconcileAccount({ account, actualBalance: actual_balance, asOf: as_of }),
        (d) =>
          d.adjustment
            ? `Đã điều chỉnh ${d.account.name}: chênh lệch ${d.difference} ${d.account.currency}.`
            : `${d.account.name} đã khớp số dư.`,
      ),
  );
}
