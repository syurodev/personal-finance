import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * Nạp `.env.test` với ngữ nghĩa ghi đè.
 *
 * Bun đã tự nạp `.env` (giá trị dev) trước khi test chạy, mà
 * `process.loadEnvFile` không ghi đè biến đã tồn tại, nên phải parse file
 * bằng `util.parseEnv` để giá trị trong `.env.test` luôn thắng.
 */
export function loadTestEnv(): void {
  const parsed = parseEnv(readFileSync('.env.test', 'utf8')) as Record<string, string>;
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] = value;
  }
}

// Chạy trong mỗi worker trước khi file test import module của app.
loadTestEnv();
