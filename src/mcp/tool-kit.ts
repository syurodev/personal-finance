import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { FINANCE_WRITE } from '../auth/constants.js';
import { DomainError } from '../common/domain-error.js';
import { currentContext, runInContext } from '../db/request-context.js';

/** Giữ tên ToolError cho code MCP hiện có; domain dùng DomainError. */
export { DomainError as ToolError };

const logger = new Logger('McpTool');

export function requireScope(scope: string): void {
  if (!currentContext().scopes.includes(scope)) {
    throw new DomainError('INSUFFICIENT_SCOPE', `Kết nối này chưa được cấp quyền ${scope}. Hãy kết nối lại và cấp quyền.`);
  }
}

export function toolResult(data: Record<string, unknown>, summary: string): CallToolResult {
  return { content: [{ type: 'text', text: summary }], structuredContent: data };
}

/**
 * Không gửi structuredContent khi lỗi: client SDK kiểm tra structuredContent theo outputSchema
 * kể cả khi isError, và sẽ ném lỗi nếu không khớp. Lỗi ngoài DomainError được log và che đi.
 */
export function toolError(error: unknown): CallToolResult {
  let body: { code: string; message: string; details?: Record<string, unknown> };
  if (error instanceof DomainError) {
    body = { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
  } else {
    const ref = randomUUID();
    logger.error(`Unexpected tool error ref=${ref}`, error instanceof Error ? error.stack : String(error));
    body = { code: 'INTERNAL_ERROR', message: 'Lỗi hệ thống, hãy thử lại sau.', details: { ref } };
  }
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }] };
}

/** Tool ghi chạy trong savepoint: lỗi giữa chừng không để lại dữ liệu ghi dở. */
async function inSavepoint<T>(fn: () => Promise<T>): Promise<T> {
  const context = currentContext();
  return context.tx.transaction((savepoint) => runInContext({ ...context, tx: savepoint }, fn));
}

export async function runTool<T extends object>(
  scope: string,
  fn: () => Promise<T>,
  summarize: (data: T) => string,
): Promise<CallToolResult> {
  try {
    requireScope(scope);
    const data = scope === FINANCE_WRITE ? await inSavepoint(fn) : await fn();
    return toolResult(data as unknown as Record<string, unknown>, summarize(data));
  } catch (error) {
    return toolError(error);
  }
}
