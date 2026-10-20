import { ToolError, toolError, toolResult } from './tool-kit.js';

describe('tool-kit', () => {
  it('toolResult returns text summary plus structured content', () => {
    expect(toolResult({ a: 1 }, 'xong')).toEqual({
      content: [{ type: 'text', text: 'xong' }],
      structuredContent: { a: 1 },
    });
  });

  it('toolError converts a ToolError into an isError result without structuredContent', () => {
    const result = toolError(new ToolError('ACCOUNT_NOT_FOUND', 'Không thấy ví', { candidates: ['Momo'] }));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      code: 'ACCOUNT_NOT_FOUND',
      message: 'Không thấy ví',
      details: { candidates: ['Momo'] },
    });
  });

  it('toolError hides unexpected errors behind INTERNAL_ERROR', () => {
    const result = toolError(new Error('connection reset by peer'));
    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).not.toContain('connection reset');
    expect(body.details.ref).toMatch(/^[0-9a-f-]{36}$/);
  });
});
