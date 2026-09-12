# 参与引擎

感谢你愿意看装置内部。请先读 [docs/核心创新与复现.md](docs/核心创新与复现.md) 与 [docs/迭代路程.md](docs/迭代路程.md)。

## 环境

- Node.js 22+（`node:sqlite`）
- 不要提交 `server/privacy.local.json`、`ingest/mneme.db`、`.env`

```bash
cp server/privacy.local.json.example server/privacy.local.json
cd web && npm ci
# 有自己的库时：
# MNEME_VAULT=/path/to/vault node --experimental-sqlite ../ingest/ingest.mjs
MNEME_TOKEN=dev-token node --experimental-sqlite ../server/server.mjs
```

前端开发：`cd web && npm run dev`（默认把 `/api` 代理到 8421）。

## 改代码时

- 隐私判定只改 `server/privacy.mjs`，并补 `npm --prefix web run test:privacy` 与 `test:api`。
- 液态玻璃与粒子只加在 `.chrome` / 弹窗上，不要铺到 `.ar-body`。
- 不要删除致谢公告，不要让背景曲在关掉致谢之前出声。
- `/assets/*` 缺失必须 404，不能回 `index.html`。
- 新增路由空间时，把懒加载写进 `lazySpace` 与 `prefetch.ts`。

## 提交

说明动机，不要只写「update」。不要带验收脚本里的默认口令或生产地址（根目录 `.gitignore` 已排除一批历史探针）。
