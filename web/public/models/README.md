# 本机模型插槽（人物人格体 · 本地推理）

> 本目录是**可插拔**的：把本地小模型的运行时与权重放在这里，人格体就会自动启用本地推理。
> 目录为空时，人格体仍然可用，但只有**信源档**（不依赖模型的「原文 + 出处」直读）。

## 为什么要放在这里

站点 CSP 是 `default-src 'self'`——**不允许从外网 CDN 拉模型**。所以运行时与权重必须与站点同源。
放在 `web/public/models/` 下的文件会被构建同步到 `dist/models/`，与站点同源发布。

## 目录约定

```
web/public/models/
├── manifest.json      ← 必需。运行时与模型清单（见下）
├── runtime.js         ← 模型运行时（ESM，导出 createEngine）
└── <weights>          ← 量化后的权重文件（配合 runtime 使用）
```

### `manifest.json` 结构

```json
{
  "name": "本机 · 0.5B Q4",
  "runtime": "/models/runtime.js",
  "model": "/models/<weights>.gguf",
  "contextWindow": 4096,
  "maxOutputTokens": 320,
  "notes": "有效窗口通常远小于标称值；预算请按有效窗口设定"
}
```

`runtime.js` 需导出一个 `createEngine(manifest)`，返回：

```js
export async function createEngine(manifest) {
  return {
    name: '本机 · 0.5B Q4',
    // onDelta 可选：用于流式增量渲染
    async generate(systemPrompt, messages, onDelta) {
      // 1) 组装 prompt：systemPrompt + messages
      // 2) 调本地推理（WebGPU 优先，WASM/CPU 回退）
      // 3) 有 onDelta 时逐段回调，最后返回完整文本
      return '完整回答文本';
    },
  };
}
```

## 选择建议（按设备）

| 设备 | 建议参数量 | 权重体积 | 说明 |
| --- | --- | --- | --- |
| 电脑 | 1.5B–3B Q4 | 0.9–2.0 GB | 有 WebGPU 时体验尚可 |
| 平板 | 1.5B Q4（吃力） | ~0.9–1.1 GB | iPad Safari 的 WebGPU 支持需实测 |
| 手机 | 0.5B 级 | 0.35–0.4 GB | 鸿蒙 ArkWeb 未开放 WebGPU，只能 CPU 回退，速度慢 |

**代价必须正视**：首次使用要下载 0.4–2 GB 权重（流量）、推理期间耗电、占用磁盘。
这是"零账单"的代价——不产生 API 费用，但不是零成本。

## 两条不可逾越的界面红线

人格体是**由档案构建、可以超越档案**的对话体，因此：

1. **不冒充确凿事实**——界面上常驻「AI 模仿体 · 非本人发言」角标，且 system prompt 明确禁止声称输出是档案记录。
2. **绝不回流正史**——对话不留存、不写回知识库；若日后想把某段对话当创作素材，必须显式标注「AI 推演」。

模型运行时**只做生成**，不参与任何访问控制。授权语料由服务端按解锁状态过滤后下发，
未授权的片段根本不会到达浏览器——本地推理因此**不可能绕过绝密/私密门禁**。

## 未放模型时的行为

`loadEngine()` 读不到 `manifest.json` 会返回 `null`，界面据此：

- **信源档**照常工作：直接呈现检索到的受控片段原文与出处，不做任何改写；
- **人格档 / 语域档**显示「本机模型未就绪」，并给出本文件的位置说明——**不假装能跑**，
  也不退回"用云端 API 编一段"（那会破坏零账单约束）。
