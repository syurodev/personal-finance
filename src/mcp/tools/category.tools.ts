import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FINANCE_WRITE } from '../../auth/constants.js';
import { CATEGORY_KINDS } from '../../db/schema/index.js';
import { createCategory, updateCategory } from '../../ledger/categories.js';
import { runTool } from '../tool-kit.js';
import { categoryRef, categoryView, WRITE } from './schemas.js';

export function registerCategoryTools(server: McpServer): void {
  server.registerTool(
    'create_category',
    {
      title: 'Tạo danh mục',
      description: 'Tạo danh mục thu hoặc chi; có thể đặt dưới một danh mục cấp 1 (tối đa 2 cấp). Hỏi người dùng trước khi tạo.',
      inputSchema: {
        name: z.string(),
        kind: z.enum(CATEGORY_KINDS).describe('expense = danh mục chi, income = danh mục thu'),
        parent: categoryRef.optional().describe('Danh mục cha cấp 1, cùng loại'),
      },
      outputSchema: categoryView.shape,
      annotations: WRITE,
    },
    async ({ name, kind, parent }) =>
      runTool(FINANCE_WRITE, () => createCategory({ name, kind, parent }), (c) => `Đã tạo danh mục "${c.name}".`),
  );

  server.registerTool(
    'update_category',
    {
      title: 'Sửa danh mục',
      description: 'Đổi tên, đổi danh mục cha (parent=null để thành cấp 1), lưu trữ hoặc mở lại danh mục.',
      inputSchema: {
        category: categoryRef,
        name: z.string().optional(),
        parent: categoryRef.nullable().optional(),
        archived: z.boolean().optional(),
      },
      outputSchema: categoryView.shape,
      annotations: WRITE,
    },
    async ({ category, name, parent, archived }) =>
      runTool(
        FINANCE_WRITE,
        () => updateCategory(category, { name, parent, archived }),
        (c) => `Đã cập nhật danh mục "${c.name}".`,
      ),
  );
}
