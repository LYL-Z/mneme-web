# ΜΝΗΜΗ · M7 云托管镜像（node:22-alpine，一体化：API + 前端 dist + 灌库数据源）
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# server 依赖（hono / @hono/node-server / pg）
COPY server/package.json ./server/package.json
RUN cd server && npm install --omit=dev --no-audit --no-fund

# 服务代码 + 前端构建产物 + SQLite 数据源（首次启动幂等灌入 PG）
COPY server/ ./server/
COPY web-dist/ ./web/dist
COPY mneme.db ./ingest/mneme.db

EXPOSE 8421
CMD ["node", "--experimental-sqlite", "server/server.mjs"]
