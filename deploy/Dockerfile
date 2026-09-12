# ΜΝΗΜΗ · M7 云托管镜像（node:22-alpine，一体化：API + 前端 dist + 灌库数据源）
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# 云托管请同时设 MNEME_MODE=cloud，以及四项口令/过滤（只放控制台）。
# server 在 cloud 模式下默认 STRICT；紧急回滚设 MNEME_STRICT=0。

# server 依赖（hono / @hono/node-server / pg）
COPY server/package.json ./server/package.json
RUN cd server && npm install --omit=dev --no-audit --no-fund

# 服务代码 + 前端构建产物 + SQLite 数据源（首次启动幂等灌入 PG）
COPY server/ ./server/
COPY web-dist/ ./web/dist
COPY mneme.db ./ingest/mneme.db

EXPOSE 8421
CMD ["node", "--experimental-sqlite", "server/server.mjs"]
