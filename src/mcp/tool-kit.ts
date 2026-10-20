import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DomainError } from '../common/domain-error.js';
import { currentContext } from '../db/request-context.js';

/** Giữ tên ToolError cho code MCP hiện có; domain dùng DomainError. */
export { DomainError as ToolError };

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
 * kể cả khi isError, và sẽ ném lỗi nếu không khớp.
 */
export function toolError(error: unknown): CallToolResult {
  if (!(error instanceof DomainError)) throw error;
  const body = { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }] };
}
