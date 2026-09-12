# ΜΝΗΜΗ

刘佑林的数字传记装置。纸色 / 墨夜双主题：时间之河、人物星图、原文档案馆、五卷书房。本机可开写作台，把公开层正文写回 Obsidian vault。

线上实例（口令进入）：https://mneme-biography.app.workbuddy.link/

本仓库是**网站引擎**，不含知识库正文、SQLite 快照或绝密配置。

## 本地运行

需要 Node.js 22+（`node:sqlite`）。

```bash
# 1. 本机绝密配置（不要提交）
cp server/privacy.local.json.example server/privacy.local.json
# 填入 secretName / secretPassword / secretDoc

# 2. 从前端
cd web && npm ci && npm run build && npm run sync:dist && cd ..

# 3. 扫描 Obsidian vault 生成只读库（路径按你的库调整）
# MNEME_VAULT="D:/The Memory/The Memory" node --experimental-sqlite ingest/ingest.mjs

# 4. 启动
MNEME_TOKEN=dev-token node --experimental-sqlite server/server.mjs
```

访问 `http://127.0.0.1:8421`，用 `MNEME_TOKEN` 进入。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `MNEME_TOKEN` | 访问口令 |
| `MNEME_ADMIN_TOKEN` | 管理口令（重扫描） |
| `MNEME_SECRET` | 绝密层解锁口令 |
| `MNEME_SECRET_NAME` | 绝密人物姓名过滤（也可写在 `privacy.local.json`） |
| `MNEME_SECRET_DOC` | 隐私测试用的绝密文档路径 |
| `MNEME_MODE=cloud` | 云模式（cookie `secure`） |
| `MNEME_STRICT=1` | 口令仍为内置开发值则拒绝启动；`MNEME_MODE=cloud` 时默认开启 |
| `MNEME_DB` | SQLite 路径，默认 `ingest/mneme.db` |
| `MNEME_VAULT` | 本机 Obsidian 库根路径（写回与监听用） |
| `MNEME_WATCH=0` | 关闭 vault 文件监听 |
| `MNEME_AI_KEY` | 可选。兼容 OpenAI 的起草密钥，只在服务端使用 |
| `MNEME_AI_BASE` | 可选。Chat Completions 根地址 |
| `MNEME_AI_MODEL` | 可选。起草模型名 |

生产环境把口令与 `MNEME_SECRET_NAME` 只放在托管平台环境变量里。云模式默认打开 STRICT；若要临时回滚，设 `MNEME_STRICT=0`。

关致谢弹窗时会在同一次点击里开启背景曲（浏览器自动播放策略要求用户手势）。绝密档案走 `POST /api/secret/unlock` 的 HttpOnly cookie；致谢与绝密门关闭都走华为式粒子消散，播完才卸 DOM。

## 不入库的内容

- `ingest/mneme.db` 与任何 `私人资料/`
- `server/privacy.local.json`
- `tmp/`、`site/`、`deploy/web-dist/` 构建产物

知识库本体在私有库 [LYL-Z/the-memory](https://github.com/LYL-Z/the-memory)。

## 许可

MIT。传记正文与第三人资料不属于本许可证授权范围。
