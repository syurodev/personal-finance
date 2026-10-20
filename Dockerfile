# App chạy thẳng từ source TS bằng Bun (không có bước build), kèm thư mục
# drizzle/ để container migration chạy được `src/db/migrate-cli.ts`.
FROM oven/bun:1.4.2

WORKDIR /app
ENV NODE_ENV=production

# Layer node_modules tách trước để tái dùng cache khi source thay đổi.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY drizzle ./drizzle
COPY src ./src
COPY tsconfig.json ./

USER 10001:10001
EXPOSE 3000
CMD ["bun", "src/main.ts"]
