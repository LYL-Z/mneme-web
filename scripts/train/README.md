# 训练 → 导出 → 接入网站（完整流水线）

> 目标：让模型**读懂全库所有资料**，每个角色都能**以第一人称**说话。
> 训练在本机 GPU 离线完成（RTX 5090 24GB 完全够用），网站只做同源加载，**运行期零账单**。

## 第 0 步 · 生成训练集

```bash
node scripts/build-ft-dataset.mjs
# 产出 ft-dataset/all.jsonl（全人物合并，推荐）+ 每人物单独 jsonl + stats.json
```

## 第 1 步 · 环境准备（Windows PowerShell，一次性）

```powershell
py -3.11 -m venv .ft-venv
.ft-venv\Scripts\activate
# ⚠ RTX 5090 = Blackwell(sm_120)：必须 cu128 及以上，旧 wheel 不支持该架构
pip install "torch>=2.7.0" --index-url https://download.pytorch.org/whl/cu128
pip install "transformers>=4.51" peft datasets accelerate sentencepiece protobuf
```

验证 GPU 可被 torch 识别（**关键一步**，5090 常见问题是 torch 版本太旧看不到卡）：

```powershell
python -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

## 第 2 步 · 训练

```bash
python scripts/train/finetune_lora.py --data ft-dataset/all.jsonl --base Qwen/Qwen2.5-1.5B-Instruct
```

- 24GB 显存跑 1.5B QLoRA 很宽裕；3B 也可行（`--base Qwen/Qwen2.5-3B-Instruct`，更慢更高质量）。
- 显存吃紧时：`--max-seq 768 --bs 1 --accum 16`。

## 第 3 步 · 合并 → 导出 ONNX → 放进网站

```powershell
pip install "optimum[onnxruntime-gpu]" onnx
optimum-cli export onnx --model out/merged --task text-generation ^
  --dtype fp16 web/public/models/qwen2.5-ft-all/onnx
```

然后更新 `web/public/models/registry.json`：新增条目

```json
{
  "id": "qwen2.5-ft-all",
  "name": "本机 · 微调版（全库人格）",
  "dir": "qwen2.5-ft-all",
  "dtype": "fp16",
  "dtypes": ["fp16"],
  "backend": "wasm",
  "sizeBytes": <实测>,
  "params": 1.5,
  "minMemoryGB": 6,
  "contextWindow": 4096,
  "maxOutputTokens": 480,
  "qualityScore": 85,
  "languages": ["zh"]
}
```

```bash
npm --prefix web run build && npm --prefix web run sync:dist
```

调度器会因 qualityScore=85 **自动优先选微调版**（也可在「调度详情」里手动切换）。

## 注意事项

- **一个模型认识所有人物**：训练集 `all.jsonl` 把每个角色的 system（人格基底+语料）都喂进去，
  因此不需要 284 个模型——运行时按 `persona_pack` 检索注入当前人物的记忆。
- **不要用全库训练"通用人格"再让 284 人共用**：训练集里每条都带各自的 system，
  模型学的是"按 system 切换人格"，不是混成一个人。
- **抽检**：训练后务必抽查 3–5 个角色的第一人称回答，确认没有把 A 的记忆安到 B 头上。
- 微调会**放大**档案语料中的既有偏见与事实，上线前人工审一遍头部角色的输出。
