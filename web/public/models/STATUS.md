# 本地模型接入 · 现状与路线（STATUS）

> 生成于 2026-09-13 · 与 `docs/人物AI对话-技术方案-2026-09-13.md` §13 配套

## 一句话现状

**调度器已完成并可用；缺的是"能同源加载的推理运行时"。** 在这一步补齐之前，人格体
自动走**信源档**（不依赖任何模型，直接给受控片段的原文与出处）——功能完整，只是"没有人格"。

## 已实测的事实（不是猜测）

| 项 | 结果 |
| --- | --- |
| 权重可下载性 | ✅ `hf-mirror.com` 可达，Qwen2.5-0.5B-Instruct **Q4_K_M = 468.6MB**，实测下载成功并已缓存在仓库外 `mneme-web/.models-cache/` |
| `@wllama/wllama` npm 包 | ⚠️ **只发布源码**：解包 709 个文件，**没有 `dist/` 编译产物**（只有 `index.ts`、`tsup.config.ts`、`CMakeLists.txt`、`a.out.js/wasm`）。包内 `wllama.js` 不含 `Wllama` 类、`loadModelFromUrl`、`createCompletion` 任何 API |
| 备用 CDN | ❌ `cdn.jsdelivr.net/npm/@wllama/wllama@3.1.1/dist/single-thread/wllama.js` → **404**；`unpkg.com` 同路径 → **404**；2.3.1 同样 **404** |
| `@huggingface/transformers` dist | ✅ **200**（`transformers.min.js` 190KB）——浏览器 ESM 包可取 |

结论：**GGUF 路线当前拿不到现成运行时**（wllama 需要自行从源码构建 WASM）；**ONNX 路线可行**
（transformers.js 的 dist 能取到），但还需把它依赖的 `onnxruntime-web` wasm 一并落到同源，
且模型要换成 ONNX 格式（另一份下载）。

## 两条可行路线（任选其一，都是一条命令级别的工作）

### 路线 A：自己构建 wllama（沿用已下好的 468MB GGUF）
```bash
# 需要 Emscripten 工具链
git clone https://github.com/ngxson/wllama && cd wllama
npm install && npm run build        # 产出 dist/single-thread/{wllama.js,wllama.wasm}
# 把 dist/single-thread/* 拷进 web/public/models/vendor/，再跑：
node scripts/fetch-model.mjs --tier small --runtime gguf
```
优点：复用已有 GGUF，模型小（0.5B）、手机也能跑。缺点：需要装 Emscripten。

### 路线 B：transformers.js + ONNX（无需编译）
```bash
node scripts/fetch-model.mjs --tier small --runtime onnx
# 脚本会：取 transformers.min.js → 取 onnxruntime-web 的 wasm → 换成 ONNX 权重 → 写 registry.json
```
优点：无需工具链。缺点：多一份 ONNX 权重下载；`onnxruntime-web` 的 wasm 路径需正确落到同源
（transformers.js 默认从 CDN 取 wasm，必须显式改 `env.backends.onnx.wasm.wasmPaths`）。

## 调度器已经做完的部分（与运行时无关）

`web/src/localModel.ts` 是**纯逻辑 + 薄加载层**，不依赖具体运行时：

1. **能力探测**：WebGPU（真实 `requestAdapter`）、WASM SIMD（`WebAssembly.validate` 探针）、
   `deviceMemory`、核数、`connection.saveData/effectiveType`、电量与充电状态、设备壳与系统。
2. **下载预算**：省流量/2G → 120MB；手机 → 700MB；平板 → 1400MB；桌面 → 2500MB。
3. **选型评分**（纯函数 `pickModel`，可单测）：语言必须含 `zh` → 后端可用性 → 内存下限 →
   体积预算（已缓存的模型不受预算限制）→ 质量分为主、**已缓存 +40**（避免重复下载几百 MB）、
   WebGPU +12 / WASM −10、手机按参数量重罚（速度与耗电）、低电量且未充电 −18、省流量 −12。
4. **预算推导**：`usable = contextWindow − maxOutputTokens − 1400(reserve)`，中文按 1.5 字符/token
   换算成 `maxChars`，`topK = clamp(maxChars/900, 4, 24)` —— 避免把窗口塞爆（§13-A 的落点）。
5. **可解释**：返回 `reason` 与 `rejected[{id, why}]`，界面「调度详情」直接展示为什么是这一档。

单测：`node web/scripts/test-localmodel.mjs`（覆盖手机无 WebGPU、桌面有 WebGPU、
省流量、低内存、已缓存优先级、预算推导边界）。

## 为什么不能"先随便接一个"糊过去

- 站点 CSP 是 `default-src 'self'`：**运行期不能从 CDN 拉模型或 wasm**，必须同源。
- 已否决云端兜底（会产生账单）——所以**不能**在模型缺席时偷偷改调云端 API 假装"接了模型"。
- 排除了这两条，唯一诚实的降级就是**信源档**：它不生成任何新表述，只呈现受控片段与出处。

## 路线 C：离线 LoRA 微调（把"全库资料"真正练进模型）

**问答**：「能不能在加载本地模型的同时，用全库资料训练该模型？」——**浏览器里做不到**：
transformers.js / onnxruntime-web **只支持推理**，没有反向传播，无法在浏览器内训练。

**真正可行的做法是「准备阶段一次性离线微调」**（本机 GPU，Python 工具链）：

```bash
# 1) 从导出的 persona_pack/persona_spec 生成对话训练集（每人物一个 jsonl）
#    system=人格基底, user=问句, assistant=第一人称回答（由档案事实构造）
# 2) 用 unsloth 或 LLaMA-Factory 做 QLoRA（Qwen2.5-0.5B/1.5B-Instruct）
pip install unsloth
# 3) 训练后合并权重并导出 ONNX（optimum exporters）
optimum-cli export onnx --model ./merged --task text-generation ./out
# 4) 把 onnx/model*.onnx 放进 web/public/models/<dir>/onnx/，更新 registry.json 的 dtypes
```

| 项 | 说明 |
| --- | --- |
| 语料来源 | `persona_pack.chunks`（全量资料，**按人物严格隔离**）+ `persona_spec`（口吻/边界） |
| 训练耗时 | 0.5B LoRA：单卡 30–90 分钟/人物；1.5B：2–4 小时/人物（284 人全做需分批） |
| 产物 | 一个"懂全库资料"的合并模型 → 站点照常同源加载，**运行期零账单不变** |
| 代价 | 每次语料/规格更新都要重训；微调会放大档案中的偏见，需人工抽检 |
| 建议 | 先给头部人物（刘佑林等）做 1–3 个试点，对比 RAG 注入效果再决定是否铺开 |

## 当前状态（2026-09-13）

- ✅ 推理链路已通：WebGPU 加载 0.5B q4f16、13 tok/s、token 计数/首字延迟/输出速度 HUD 均工作
- ✅ 上下文硬预算：输入+输出绝不超 n_ctx（超窗=KV 溢出=胡言乱语，已加动态裁剪与动态输出上限）
- ⏳ 0.5B 是**最小验证档**，中文人格扮演质量有限——要"像真人交流"请下载 1.5B（`--tier medium`，约 1.1GB），
  调度器会在桌面端自动优先选它
- ⏳ 神经语音（kokoro 等本地 TTS）为可选增强，尚未接入；当前语音走系统 TTS（零账单）
