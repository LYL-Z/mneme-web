#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ΜΝΗΜΗ · 人物人格体 · 离线 LoRA 微调（RTX 5090 / Blackwell）

目的：把**全库人物语料**（scripts/build-ft-dataset.mjs 产出的 jsonl）练进 Qwen2.5-Instruct，
让一个模型认识**所有**人物、并以各自第一人称说话；合并导出 ONNX 后由网站同源加载（零账单）。

环境（Windows PowerShell，一次性）：
    py -3.11 -m venv .ft-venv
    .ft-venv\\Scripts\\activate
    # ⚠ RTX 5090 是 Blackwell(sm_120)：必须用 cu128 及以上的 torch，旧 wheel 不支持
    pip install "torch>=2.7.0" --index-url https://download.pytorch.org/whl/cu128
    pip install "transformers>=4.51" peft datasets accelerate sentencepiece protobuf
    pip install "optimum[onnxruntime-gpu]" onnx onnxruntime-gpu   # 导出 ONNX 用

用法：
    python scripts/train/finetune_lora.py --data ft-dataset/all.jsonl --base Qwen/Qwen2.5-1.5B-Instruct
    # 显存不够就把 --base 换成 Qwen/Qwen2.5-0.5B-Instruct，或加 --max-seq 768

产出：
    out/lora-adapter/      LoRA 适配器（可复用、可继续训练）
    out/merged/            合并后的完整模型（HF 格式）
    → 再用 scripts/train/export_onnx.md 的命令导出 ONNX 并放进 web/public/models/
"""
import argparse, json, os
import torch
from datasets import load_dataset
from transformers import (AutoModelForCausalLM, AutoTokenizer, TrainingArguments,
                          DataCollatorForSeq2Seq, Trainer)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="build-ft-dataset.mjs 产出的 jsonl")
    ap.add_argument("--base", default="Qwen/Qwen2.5-1.5B-Instruct")
    ap.add_argument("--out", default="out")
    ap.add_argument("--epochs", type=float, default=2.0)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--max-seq", type=int, default=1024)
    ap.add_argument("--bs", type=int, default=2)
    ap.add_argument("--accum", type=int, default=8)
    ap.add_argument("--rank", type=int, default=32)
    args = ap.parse_args()

    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

    tok = AutoTokenizer.from_pretrained(args.base, trust_remote_code=True)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        args.base,
        torch_dtype=torch.bfloat16,          # 5090 支持 bf16；不要用 fp32（显存×2）
        attn_implementation="sdpa",
        device_map="cuda",
    )
    model.gradient_checkpointing_enable()
    model.config.use_cache = False

    lora = LoraConfig(
        r=args.rank, lora_alpha=args.rank * 2, lora_dropout=0.05, bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    ds = load_dataset("json", data_files=args.data, split="train")

    def to_features(ex):
        """用模型自带 chat template 组装，并做 loss mask（只对 assistant 部分计 loss）。"""
        msgs = ex["messages"]
        prompt_ids = tok.apply_chat_template(msgs[:-1], tokenize=True, add_generation_prompt=True)
        full_ids = tok.apply_chat_template(msgs, tokenize=True, add_generation_prompt=False)
        prompt_ids = prompt_ids[: args.max_seq]
        full_ids = full_ids[: args.max_seq]
        labels = [-100] * len(prompt_ids) + full_ids[len(prompt_ids):]
        return {"input_ids": full_ids, "attention_mask": [1] * len(full_ids), "labels": labels}

    feats = ds.map(to_features, remove_columns=ds.column_names)

    targs = TrainingArguments(
        output_dir=os.path.join(args.out, "ckpt"),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.bs,
        gradient_accumulation_steps=args.accum,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.03,
        logging_steps=10,
        save_strategy="epoch",
        bf16=True,
        report_to=[],
        remove_unused_columns=False,
    )
    Trainer(model=model, args=targs, train_dataset=feats,
            data_collator=DataCollatorForSeq2Seq(tok, padding=True)).train()

    merged_dir = os.path.join(args.out, "merged")
    model = model.merge_and_unload()
    model.config.use_cache = True
    model.save_pretrained(merged_dir, safe_serialization=True)
    tok.save_pretrained(merged_dir)
    print("\n✅ 训练完成。")
    print("  LoRA 适配器 :", os.path.join(args.out, "ckpt"))
    print("  合并模型     :", merged_dir)
    print("\n下一步：导出 ONNX 并放进网站（见 scripts/train/README.md 第 3 步）")

if __name__ == "__main__":
    main()
