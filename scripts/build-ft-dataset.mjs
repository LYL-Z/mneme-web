#!/usr/bin/env node
/**
 * ΜΝΗΜΗ · build-ft-dataset.mjs —— 为**离线 LoRA 微调**生成对话训练集
 *
 * 目的：让模型「读懂全库所有资料、每个人物都能以第一人称说话」。
 * 浏览器内无法训练（transformers.js/onnxruntime-web 只支持推理），
 * 所以微调在本机 GPU（如 RTX 5090 24GB）离线完成，产物再交网站同源加载。
 *
 * 产出：
 *   ft-dataset/all.jsonl            全人物合并训练集（**推荐**：一个模型认识所有人）
 *   ft-dataset/<dir>.jsonl          每个人物单独一份（试点/对比用）
 *   ft-dataset/stats.json           覆盖统计
 *
 * 数据形态（ChatML 风格，训练脚本会套 tokenizer 的 chat template）：
 *   {"messages":[{"role":"system","content":人格基底+语料},
 *                {"role":"user","content":问题},
 *                {"role":"assistant","content":"<think>…</think>第一人称回答"}]}
 *
 * 诚实说明：assistant 回答由**档案事实 + 模板化第一人称改写**构成，
 *   没有经过任何 LLM 润色——它教的是「人物身份 + 档案事实 + 第一人称口吻」，
 *   让模型学会"以 TA 的身份说话并知道档案内容"。要更自然的语流，
 *   可在生成后用任意 LLM 对 jsonl 做一轮人工抽检/润色（脚本提供 --only-skip-llm 的口径）。
 *
 * 用法：node scripts/build-ft-dataset.mjs [--min-chunks 20] [--out ft-dataset]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DB = path.join(ROOT, 'ingest', 'mneme.db');
const OUT = path.join(ROOT, process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'ft-dataset');
const MIN_CHUNKS = Number(process.argv[process.argv.indexOf('--min-chunks') + 1] || 12);

const argv = process.argv.slice(2);
const db = new DatabaseSync(DB, { readOnly: true });

/* 由 persona_spec 的人格基底（抽取式，无编造）+ 该人物全部 chunk 构造 system */
function systemFor(spec, pack) {
  const corpus = (pack.chunks || [])
    .filter(c => c.tier === 'public')
    .slice(0, 40)
    .map((c, i) => `[${i + 1}]（${c.path}${c.kind ? ' · ' + c.kind : ''}）${c.text}`)
    .join('\n');
  const boundary = (spec.boundaries || []).length ? '\n你不知道的事：\n' + spec.boundaries.map(b => '· ' + b).join('\n') : '';
  return [
    `你是「${pack.display_name}」的 AI 人格体。`,
    '你由刘佑林的记忆档案构建：说话以第一人称，自然、口语、像真实的人在聊天；',
    '档案是你的记忆底色——你可以聊档案里的事，也可以自然地即兴日常，但不要冒充"这是史料记录"。',
    spec.summary || '',
    '\n【你的记忆素材（节选）】\n' + corpus,
    boundary,
  ].filter(Boolean).join('\n');
}

/* 由 chunk 构造第一人称问答对（模板化改写，不引入档案外事实） */
function qaPairs(pack, spec) {
  const pairs = [];
  const nm = pack.display_name;
  const selfChunks = (pack.chunks || []).filter(c => c.kind === '自档');
  const memChunks = (pack.chunks || []).filter(c => c.kind !== '自档' && c.tier === 'public');

  /* ① 身份问答 */
  if (selfChunks.length) {
    pairs.push({
      user: `你是谁？`,
      assistant: `<think>我是${nm}，按档案说话。</think>${pick(selfChunks[0].text, 320)}`,
      cite: selfChunks[0].path,
    });
  }
  /* ② 记忆问答（每段档案一段） */
  for (const c of memChunks.slice(0, 40)) {
    const lead = c.year ? `${c.year} 年` : '那段时候';
    pairs.push({
      user: pickQuestion(c, nm),
      assistant: `<think>想起${lead}的事。</think>${pick(c.text, 260)}`,
      cite: c.path,
    });
  }
  /* ③ 日常闲聊（用语言特征语料教口吻） */
  if (spec.langStyle && pack.has_lang_corpus) {
    for (const s of (spec.langStyle.原句示例 || []).slice(0, 6)) {
      pairs.push({
        user: '最近怎么样？',
        assistant: `<think>随便聊聊。</think>${pick(String(s), 200)}`,
        cite: '语言特征语料',
      });
    }
  }
  return pairs;
}
function pick(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}
function pickQuestion(chunk, nm) {
  const qs = ['给我讲讲那时候的事？', '你记得这件事吗？', '那时候是什么样的？', '跟我聊聊那段日子？', '这件事你是怎么看的？'];
  const year = chunk.year ? `${chunk.year} 年你在做什么？` : null;
  const arr = year ? [year, ...qs] : qs;
  return arr[chunk.id % arr.length];
}

/* ---------- 主流程 ---------- */
fs.mkdirSync(OUT, { recursive: true });
const packs = db.prepare('SELECT entity_id, display_name, can_chat, has_lang_corpus, chunks FROM persona_pack WHERE can_chat=1').all();
const specOf = db.prepare('SELECT * FROM persona_spec WHERE entity_id=?');

const stats = { characters: 0, pairs: 0, perFile: [], skipped: [] };
const allFd = fs.openSync(path.join(OUT, 'all.jsonl'), 'w');
let allN = 0;

for (const p of packs) {
  const spec = specOf.get(p.entity_id);
  const chunks = safeArr(p.chunks);
  if (chunks.length < MIN_CHUNKS) { stats.skipped.push({ name: p.display_name, chunks: chunks.length }); continue; }
  const specObj = spec ? {
    langStyle: j(spec.lang_style), facts: j(spec.facts), relations: j(spec.relations),
    valuesTopics: j(spec.values_topics), habits: j(spec.habits), boundaries: j(spec.boundaries),
    summary: spec.summary || '',
  } : { boundaries: [], langStyle: null };
  const pack = {
    display_name: p.display_name, can_chat: true, has_lang_corpus: Number(p.has_lang_corpus) === 1,
    chunks: chunks.map((c, i) => ({ id: i + 1, tier: c.tier, text: c.text, path: c.path, kind: c.kind, year: c.year, evidence_kind: c.evidence_kind })),
  };
  const sys = systemFor(specObj, pack);
  const pairs = qaPairs(pack, specObj);
  if (!pairs.length) { stats.skipped.push({ name: p.display_name, reason: 'no_pairs' }); continue; }

  const slug = (p.display_name || 'x').replace(/[\\/:*?"<>|\s]/g, '_').slice(0, 40) || ('id' + p.entity_id);
  const f = path.join(OUT, slug + '.jsonl');
  const fd = fs.openSync(f, 'w');
  let n = 0;
  for (const qa of pairs) {
    const row = { messages: [
      { role: 'system', content: sys },
      { role: 'user', content: qa.user },
      { role: 'assistant', content: qa.assistant },
    ], meta: { entity: p.entity_id, name: p.display_name, cite: qa.cite } };
    fs.writeSync(fd, JSON.stringify(row) + '\n');
    fs.writeSync(allFd, JSON.stringify(row) + '\n');
    n++; allN++; stats.pairs++;
  }
  fs.closeSync(fd);
  stats.characters++;
  stats.perFile.push({ file: path.basename(f), name: p.display_name, pairs: n });
}
fs.closeSync(allFd);
fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify({ ...stats, minChunks: MIN_CHUNKS, generatedAt: new Date().toISOString() }, null, 2));
console.log(`✓ 训练集完成：${stats.characters} 个人物 · ${stats.pairs} 对问答 · 合并集 all.jsonl（${allN} 行）`);
console.log(`  目录：${OUT}`);
console.log(`  跳过 ${stats.skipped.length} 个（素材不足）`);
console.log('\n下一步：node scripts/train/finetune_lora.py --data ' + path.join(OUT, 'all.jsonl') + '  （见该脚本头部说明）');

function j(s, d = []) { try { const v = JSON.parse(s); return v ?? d; } catch { return d; } }
function safeArr(s) { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } }
