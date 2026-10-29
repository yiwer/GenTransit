# GenTransit 应用镜像（M4 计划 4.1 节）。多阶段构建，基础镜像 bookworm-slim（不用 alpine，避开 Prisma 与 argon2 的 musl 问题）。
# 镜像里没有 .env，也不接收任何高德变量：密钥全部在运行时通过环境变量传入。
# 构建：deploy/build.sh（打 gentransit:<版本>-<短哈希> 与 latest 两个标签）
ARG NODE_IMAGE=node:24.21.0-bookworm-slim

FROM ${NODE_IMAGE} AS build
ENV CI=true
# Prisma 的 schema engine 需要 OpenSSL
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /src
# 先只复制清单安装依赖，源码变化时复用这一层
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm -r build
# 服务端的生产依赖（含共享包与执行迁移用的 Prisma CLI）导出到 /out
RUN pnpm --filter @gentransit/server deploy --prod --legacy /out

FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=dev
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WEB_DIST=/app/web \
    UPLOAD_DIR=/data/uploads \
    APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json /out/prisma.config.ts ./
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=build --chown=node:node /out/prisma/migrations ./prisma/migrations
COPY --from=build --chown=node:node /src/apps/web/dist ./web
COPY --chmod=755 deploy/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
EXPOSE 3000
# 镜像里没有 curl，用 Node 自带的 fetch
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/app/docker-entrypoint.sh"]
