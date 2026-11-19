# 第一阶段：依赖安装与全仓构建
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# 安装编译 better-sqlite3 原生扩展所需系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY tools/notion-import/package.json tools/notion-import/tsconfig.json ./tools/notion-import/
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY apps/web/package.json apps/web/tsconfig.json ./apps/web/

RUN pnpm install --frozen-lockfile || pnpm install

COPY packages ./packages
COPY tools ./tools
COPY apps ./apps

RUN pnpm -r --workspace-concurrency=1 build

# 第二阶段：精简生产运行镜像
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3210
ENV DATA_DIR=/data
ENV TZ=Asia/Shanghai
ENV COOKIE_SECURE=auto

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=builder /app/tools/notion-import/package.json ./tools/notion-import/
COPY --from=builder /app/tools/notion-import/dist ./tools/notion-import/dist
COPY --from=builder /app/tools/notion-import/node_modules ./tools/notion-import/node_modules
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/web/dist ./apps/web/dist

RUN mkdir -p /data/backups && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 3210

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3210) + '/api/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

USER node
CMD ["node", "apps/api/dist/server.js"]
