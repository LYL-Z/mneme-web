/**
 * ΜΝΗΜΗ · persona 服务层 —— 人物人格体的「授权语料组装」
 *
 * 定位（见 docs/人物AI对话-技术方案-2026-09-13.md §14）：
 *   人格体是**由档案构建、可以超越档案**的对话体，不是档案应答体。
 *   因此本模块**不做编造审查**——它只负责两件必须由服务端把关的事：
 *     ① **授权**：未授权 chunk 绝不出现在返回值里（本地推理不得绕过门禁）；
 *     ② **组装**：按档位产出 systemPrompt + 受控语料片段（常驻人格基底 + 检索注入）。
 *
 * 三条不可动摇的约束：
 *   · tier 判定来自 ./privacy.mjs（唯一事实来源），本文件不自行复写规则。
 *   · 绝密人物未解锁 → 入口级拒绝（与现有绝密门同源）。
 *   · 私密/绝密 chunk 的**真实路径不返回给前端**（改为 pathLabel），避免路径枚举。
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSecretText, isPrivatePath, isSecretPath } from './privacy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.MNEME_DB || path.join(HERE, '..', 'ingest', 'mneme.db');
const POLICY_PATH = path.join(HERE, 'persona-policy.json');

const DEFAULT_MAX_CHARS = 12000;   // 检索注入预算（约 5–7k token，按本地小模型有效窗口保守设定）
const TOP_K = 8;                   // 检索注入片段数上限
const CACHE_MAX = 8;               // 解析缓存条数（全量语料后单人可达数十 MB，别缓存太多）

/* ---------- 只读连接（惰性，支持运行期换库） ---------- */
let _db = null;
let _dbMtime = 0;
function db() {
  const m = (() => { try { return fs.statSync(DB_PATH).mtimeMs; } catch { return 0; } })();
  if (!_db || m !== _dbMtime) {
    try { _db?.close(); } catch { /* 已关 */ }
    _db = new DatabaseSync(DB_PATH, { readOnly: true });
    _dbMtime = m;
    _cache.clear();
  }
  return _db;
}

/* ---------- 解析缓存（LRU） ---------- */
const _cache = new Map();
function packOf(entityId) {
  if (_cache.has(entityId)) {
    const v = _cache.get(entityId);
    _cache.delete(entityId); _cache.set(entityId, v);   // refresh LRU
    return v;
  }
  let v = null;
  try {
    const p = db().prepare('SELECT * FROM persona_pack WHERE entity_id=?').get(entityId);
    const s = db().prepare('SELECT * FROM persona_spec WHERE entity_id=?').get(entityId);
    if (p) {
      v = {
        pack: {
          entityId: Number(p.entity_id), name: String(p.display_name || ''),
          mentionCount: Number(p.mention_count) || 0, hasRoleDoc: Number(p.has_role_doc) === 1,
          supportAssets: Number(p.support_assets) || 0, canChat: Number(p.can_chat) === 1,
          hasLangCorpus: Number(p.has_lang_corpus) === 1,
          tierCounts: safeJson(p.tier_counts, { public: 0, private: 0, secret: 0 }),
          chunks: safeJson(p.chunks, []),
        },
        spec: s ? {
          langStyle: safeJson(s.lang_style, null), facts: safeJson(s.facts, []),
          relations: safeJson(s.relations, []), valuesTopics: safeJson(s.values_topics, []),
          habits: safeJson(s.habits, []), boundaries: safeJson(s.boundaries, []),
          summary: String(s.summary || ''), langConfirmedBy: s.lang_confirmed_by || null,
        } : null,
      };
    }
  } catch { v = null; }
  if (v) {
    _cache.set(entityId, v);
    while (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value);
  }
  return v;
}
const safeJson = (s, dflt) => { try { const v = JSON.parse(s); return v ?? dflt; } catch { return dflt; } };

/* ---------- 库主策略（默认不启用） ----------
   林哥决定：persona-policy.json「保留但先不启用」。
   因此：文件不存在、或 enabled !== true 时，本函数**一律返回 false（全放行）**。
   只有当库主显式写入 { "enabled": true, "disabled": [id...] } 才生效。 */
let _policyCache = null; let _policyMtime = 0;
export function isPersonaDisabled(entityId) {
  try {
    const m = fs.statSync(POLICY_PATH).mtimeMs;
    if (m !== _policyMtime) { _policyCache = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8')); _policyMtime = m; }
  } catch { return false; }
  if (!_policyCache || _policyCache.enabled !== true) return false;
  const list = Array.isArray(_policyCache.disabled) ? _policyCache.disabled.map(Number) : [];
  return list.includes(Number(entityId));
}

/* ---------- 检索（无向量库；中文 bigram 重合度） ---------- */
function bigrams(s) {
  const t = String(s || '').replace(/[\s\p{P}]+/gu, '');
  const set = new Set();
  if (!t) return set;
  if (t.length === 1) { set.add(t); return set; }
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}
function score(queryGrams, text) {
  if (!queryGrams.size) return 0;
  const g = bigrams(text);
  let hit = 0;
  for (const x of queryGrams) if (g.has(x)) hit++;
  return hit / queryGrams.size;
}

/* ---------- 档位元数据 ---------- */
export function personaModes(pack) {
  const modes = [];
  if (!pack || !pack.pack.canChat) return modes;
  modes.push({ mode: 'persona', label: '人格档', desc: '像和他本人说话——由档案构建，可即兴', available: true, reason: null });
  modes.push({
    mode: 'voice', label: '语域档', desc: '用他的用词与称呼作答，但明示为档案再现',
    available: pack.pack.hasLangCorpus,
    reason: pack.pack.hasLangCorpus ? null : 'no_lang_corpus',
  });
  modes.push({ mode: 'source', label: '信源档', desc: '客观档案口吻，只依据片段并逐条给出依据', available: true, reason: null });
  return modes;
}

/* ---------- GET /api/persona/:id ---------- */
export function personaMeta(entityId) {
  const pack = packOf(entityId);
  if (!pack) return { ok: false, code: 404, reason: 'no_persona_pack' };
  const p = pack.pack;
  return {
    ok: true,
    id: p.entityId,
    display_name: p.name,
    can_chat: p.canChat,
    reason: p.canChat ? null : 'insufficient_corpus',
    locked: false,                       // 绝密锁在 server.mjs 层按解锁状态判定并覆盖
    needs_unlock_for_private: (p.tierCounts.private || 0) + (p.tierCounts.secret || 0) > 0,
    tier_counts: p.tierCounts,
    mention_count: p.mentionCount,
    has_role_doc: p.hasRoleDoc,
    support_assets: p.supportAssets,
    has_lang_corpus: p.hasLangCorpus,
    disabled: isPersonaDisabled(p.entityId),
  };
}

/* ---------- 三份 systemPrompt（不可共用） ---------- */
const RED_LINES = `【两条不可逾越的红线】
1. **不得冒充确凿事实**：你可以自然交谈，但绝不能声称自己说的这些话是"档案记录""可被引用的史实"。
2. **绝不回流正史**：你的输出不会、也不得被写入档案或传记素材；你是一段对话，不是史料。`;

function buildPrompt(mode, p, spec) {
  const base = spec?.summary || `【人物】${p.name}`;
  const boundaries = (spec?.boundaries || []).map(b => `· ${b}`).join('\n') || '· （未检出明显缺口）';
  const langHint = p.hasLangCorpus && spec?.langStyle
    ? `\n【语域特征（抽取自其本人语料，非推断）】\n标点画像：${JSON.stringify(spec.langStyle.标点画像)}\n称呼人称：${(spec.langStyle.称呼人称 || []).map(x => `${x.w}×${x.c}`).join(' ')}\n高频片段：${(spec.langStyle.高频片段 || []).map(x => x.g).join('、')}\n原句示例：\n${(spec.langStyle.原句示例 || []).slice(0, 3).map(s => `· ${s}`).join('\n')}`
    : `\n【语域特征】该人物没有可用的本人语料——**不要模仿口吻**，用中性、克制的表达。`;

  if (mode === 'persona') {
    return `你正在扮演「${p.name}」的 AI 模仿体，供访问者与其交谈。

【你的性质】
你不是一个查档案的问答机器人，而是**由档案构建出来的人格体**。档案是你的基底与底色，但**你不必只遵循档案**：可以自然回应、可以有情绪、可以聊档案之外的日常话题——像一个人在日常生活里说话那样。目标是让对话自然、有温度、像他。

【你应当尽量与档案一致的部分】
档案里明确记录的事实、关系、时间线、称呼习惯，尽量保持一致；不确定时用自然的模糊表达（"记不太清"），而不是硬编一个精确事实。

${base}
${langHint}

【你不知道的部分（请自然地表现"不知道"，而不是编造得很确定）】
${boundaries}

${RED_LINES}
【表达】用第一人称，中文，口语化，长短句交错，不要用 markdown 小标题，不要解释你的设定。首次回应请在开头用一句自然的话表明"我是根据档案生成的 AI 模仿体"。`;
  }

  if (mode === 'voice') {
    return `你是一个以「${p.name}」的语域作答的**档案再现体**。

【你的性质】你在用他的用词、称呼与语气回应，但**你不是他本人**——每段回答都要让人看得出来这是"依据档案的再现"，不是本人在发声。

${base}
${langHint}

【你不知道的部分】
${boundaries}

${RED_LINES}
【表达】中文，尽量贴近其语域；不主动即兴档案之外的情节；不编造未记录的对白与心理。`;
  }

  // source：信源档——这个档位**仍守旧的严格铁律**
  return `你是一个客观的人物档案应答体，负责依据给定片段回答关于「${p.name}」的问题。

【硬约束】
1. **只依据**下方给定的编号片段回答；材料不支持的事实，整句标注【待采】，不得编造对白、心理、动机或未记录的事件。
2. 每条事实性回答末尾列出所用编号，如 [3][7]。
3. 不得推测该人物的情感态度，也不得用提及次数推断人格或亲疏。
4. 保持第三人称、克制、档案口吻；不使用第一人称扮演。

${base}

【你不知道的部分】
${boundaries}`;
}

/* ---------- POST /api/persona/:id/context ---------- */
export function buildPersonaContext(entityId, opts = {}) {
  const requested = ['persona', 'voice', 'source'].includes(opts.mode) ? opts.mode : 'persona';
  const unlocked = !!opts.unlocked;
  const maxChars = Number(opts.maxChars) > 0 ? Number(opts.maxChars) : DEFAULT_MAX_CHARS;
  const topK = Number(opts.topK) > 0 ? Math.min(Number(opts.topK), 40) : TOP_K;
  const pack = packOf(entityId);
  if (!pack) return { ok: false, code: 404, reason: 'no_persona_pack' };

  const p = pack.pack;
  const spec = pack.spec;

  /* 语域档在「没有本人语料」时只能退化为中性表达——明确降级并告知前端，
     避免界面承诺"像他说话"而实际做不到（那才是真正的失真）。 */
  let mode = requested;
  let modeAdjusted = null;
  if (mode === 'voice' && !p.hasLangCorpus) { mode = 'persona'; modeAdjusted = 'no_lang_corpus'; }

  /* ① 人物级整档锁：绝密人物未解锁 → 直接拒绝（与现有绝密门同源） */
  if (isSecretText(p.name) && !unlocked) return { ok: false, code: 403, reason: 'locked' };
  /* ② 库主策略（默认不启用） */
  if (isPersonaDisabled(p.entityId)) return { ok: false, code: 403, reason: 'disabled_by_owner' };
  /* ③ 门槛 */
  if (!p.canChat) return { ok: false, code: 403, reason: 'insufficient_corpus' };

  /* ④ 授权过滤——本功能的门禁核心：未授权 chunk 绝不进入返回值 */
  const all = p.chunks || [];
  const allowed = all.filter(c => c.tier === 'public' || (unlocked && (c.tier === 'private' || c.tier === 'secret')));
  const blockedCount = all.length - allowed.length;

  /* ⑤ 检索注入：按 query 的 bigram 重合度排序，预算内取 top-K
     「自档」片段加分——身份/性格类问题优先命中该人物自己的档案页。
     排序**不做 tier 偏好**：解锁后私密内容也按相关度竞争，与「包含档案全部内容」一致。
     query 为空（首轮问候）时：先给自档，再分层均衡采样，保证开场就有宽基底。 */
  const qGrams = bigrams(opts.query || '');
  const boost = (c) => (c.kind === '自档' ? 0.2 : 0) + (c.evidence_kind ? 0.05 : 0);
  let ranked;
  if (qGrams.size === 0) {
    const self = allowed.filter(c => c.kind === '自档');
    const pub = allowed.filter(c => c.tier === 'public' && c.kind !== '自档');
    const rest = allowed.filter(c => c.tier !== 'public' && c.kind !== '自档');
    const ordered = [...self];
    let i = 0, j = 0;
    while (i < pub.length || j < rest.length) {
      for (let k = 0; k < 3 && i < pub.length; k++) ordered.push(pub[i++]);
      if (j < rest.length) ordered.push(rest[j++]);
    }
    ranked = ordered.map(c => ({ c, s: boost(c) }));
  } else {
    ranked = allowed
      .map(c => ({ c, s: score(qGrams, c.text) + boost(c) }))
      .sort((a, b) => b.s - a.s || a.c.id - b.c.id);
  }

  const picked = [];
  let used = 0;
  for (const { c } of ranked) {
    if (picked.length >= topK) break;
    if (used + c.text.length > maxChars && picked.length > 0) continue;
    picked.push(c);
    used += c.text.length;
    if (used >= maxChars) break;
  }
  picked.sort((a, b) => a.id - b.id);

  /* ⑥ 路径脱敏：私密/绝密只给标签，不暴露真实路径 */
  const chunks = picked.map(c => ({
    id: c.id, tier: c.tier, text: c.text,
    path: c.tier === 'public' ? c.path : null,
    pathLabel: c.tier === 'public' ? c.path : '私密档案 · 已授权',
    kind: c.kind || '', year: c.year ?? null, evidenceKind: c.evidence_kind || '',
  }));

  return {
    ok: true,
    mode,
    modeRequested: requested,
    modeAdjusted,
    systemPrompt: buildPrompt(mode, p, spec),
    base: spec?.summary || '',
    chunks,
    meta: {
      id: p.entityId, name: p.name,
      tierCounts: p.tierCounts,
      retrieved: chunks.length,
      blockedByUnlock: blockedCount,
      budgetUsed: used,
      canChat: p.canChat,
      hasLangCorpus: p.hasLangCorpus,
    },
  };
}

/** 供 server.mjs 判定"是否需要先解锁"（内容级提示） */
export function personaNeedsUnlock(entityId) {
  const pack = packOf(entityId);
  if (!pack) return false;
  const t = pack.pack.tierCounts || {};
  return (t.private || 0) + (t.secret || 0) > 0;
}

export function personaTierCounts(entityId) {
  return packOf(entityId)?.pack.tierCounts || null;
}
