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

  it('toolError rethrows unexpected errors', () => {
    expect(() => toolError(new Error('boom'))).toThrow('boom');
  });
});
