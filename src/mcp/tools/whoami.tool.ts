import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { FINANCE_READ } from '../../auth/constants.js';
import { currentContext } from '../../db/request-context.js';
import { requireScope, toolError, toolResult } from '../tool-kit.js';

export function registerWhoamiTool(server: McpServer): void {
  server.registerTool(
    'whoami',
    {
      title: 'Kiểm tra kết nối',
      description:
        'Trả về thông tin kết nối hiện tại: user, client và các quyền đã cấp. Dùng khi cần kiểm tra kết nối hoạt động.',
      outputSchema: {
        user_id: z.string(),
        client_id: z.string(),
        scopes: z.array(z.string()),
        db_user_context: z.string(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        requireScope(FINANCE_READ);
        const { userId, clientId, scopes, tx } = currentContext();
        const result = await tx.execute<{ value: string | null }>(
          sql`select current_setting('app.user_id', true) as value`,
        );
        const data = {
          user_id: userId,
          client_id: clientId ?? '',
          scopes: [...scopes],
          db_user_context: result.rows[0]?.value ?? '',
        };
        return toolResult(data, `Kết nối hoạt động. Quyền: ${data.scopes.join(', ')}.`);
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
