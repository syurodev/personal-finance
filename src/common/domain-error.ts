/** Lỗi nghiệp vụ có mã ổn định. Tầng MCP chuyển nó thành kết quả isError cho agent. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
