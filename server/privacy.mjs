/**
 * ΜΝΗΜΗ · 隐私与绝密门禁规则（唯一事实来源）
 *
 * 为什么单独成模块：历史上 server.mjs / store.mjs / store-pg.mjs 各写了一套判定，
 * 三套规则不一致，导致「锁了 /api/doc、漏了 /api/search|graph|entities|timeline|domains」的旁路。
 * 现在所有出口共用本模块的判定，禁止在别处重新实现。
 *
 * 三级可见性：
 *   public   公开层
 *   private  私密层（私人资料/ 隐私/）：未解锁时一律「不存在」→ 404，不可枚举
 *   secret   绝密档案（绝密人物全宗 + 赵问竹相关章节材料 + 非父母卷问卷）：
 *            未解锁时目录/星图/检索以锁定档出现（可见章题，不见正文）；点开 → 403（管理员密码）
 *            六部书房本身公开。不是整部上锁。
 *
 * 绝密姓名 / 口令不进仓库：优先环境变量，其次本目录 gitignore 的 privacy.local.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const loadLocalPrivacy = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(HERE, 'privacy.local.json'), 'utf8'));
  } catch { return {}; }
};
export const LOCAL_PRIVACY = loadLocalPrivacy();

export const SECRET_NAME = String(process.env.MNEME_SECRET_NAME || LOCAL_PRIVACY.secretName || '').trim();
export const SECRET_DOC = String(process.env.MNEME_SECRET_DOC || LOCAL_PRIVACY.secretDoc || '').trim();
export const SECRET_VOLUMES = [];
/** 《补写的手册》里赵问竹加密度章。目录公开，点开走绝密弹窗。 */
export const SECRET_CHAPTER_SEQ = [23, 26, 27, 28, 29, 30, 31, 32, 33, 34, 39, 41, 48, 51, 57, 58, 59];
const SECRET_WORK_RE = /章节设计-第[二三]卷|试写\/第三卷|第三卷样章|百万长文写作\/人物\.md|章稿\/第三部/;
export const QUESTIONNAIRE_MARK = '问卷作答全文';
/** 父母卷作答全文公开，其余问卷作答全文属绝密 */
export const PARENT_LABELS = new Set(['母亲', '父亲', '妈妈', '爸爸']);
export const isParentLabel = (l) => PARENT_LABELS.has(String(l || '').trim());

const PRIV_RE = /私人资料|(^|\/|\b)隐私(\/|\b)/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sqlLit = (s) => String(s).replace(/'/g, "''");
/** 路径是否落在私密层 */
export const isPrivatePath = (p) => PRIV_RE.test(p || '');
/** 文档路径是否属绝密人物全宗或赵纲施工稿 */
export const isSecretPath = (p) => {
  const s = String(p || '');
  if (SECRET_WORK_RE.test(s)) return true;
  return !!SECRET_NAME && s.includes(SECRET_NAME);
};
/** 任意字符串（display_name / 意象名 / 标题）是否命中绝密姓名 */
export const isSecretText = (s) => !!SECRET_NAME && String(s || '').includes(SECRET_NAME);
/** 实体是否落在私密层（std_id 或 role_doc_path 命中私密路径） */
export const isPrivateEntity = (e) => isPrivatePath(e?.std_id) || isPrivatePath(e?.role_doc_path);
/** 实体是否属绝密档案（姓名命中） */
export const isSecretEntity = (e) => isSecretText(e?.display_name);
/** 实体是否指向「问卷作答全文」文档（父母卷除外）——未解锁时不得被枚举，
 *  否则「某同学 · 问卷作答全文（V3 批次）」这类文档型实体会把问卷作答人身份列出来。 */
export const isQuestionnaireEntity = (e) => {
  const refs = [e?.std_id, e?.role_doc_path, e?.display_name].map(v => String(v || ''));
  if (!refs.some(v => v.includes(QUESTIONNAIRE_MARK))) return false;
  return !refs.some(v => [...PARENT_LABELS].some(l => v.startsWith(l)));
};
/** 统一出口判定：未解锁时该实体是否必须从任何列表中消失。
 *  绝密人物不再消失——以锁定档出现，点开再走管理员密码。私密层与非父母卷问卷仍不可枚举。 */
export const mustHideEntity = (e, unlocked) =>
  !unlocked && (isPrivateEntity(e) || isQuestionnaireEntity(e));

export const isSecretChapter = (r = {}) => {
  if (r.secret === 1 || r.secret === true) return true;
  if (r.kind === 'interlude' || r.kind === 'appendix') return !!r.secret;
  const seq = Number(r.seq);
  return Number.isFinite(seq) && SECRET_CHAPTER_SEQ.includes(seq);
};

/** 列表/检索命中是否应标成锁定档（可见标题，不见正文）。
 *  时间线事件带 year+kind：只按姓名锁定，不因部号把整条河上锁。
 *  赵纲章节材料点开走弹窗，不从目录消失。 */
export const isLockedStub = (r = {}) => {
  if (isSecretPath(r.path || r.doc_path || r.doc || '')) return true;
  if (isSecretText(r.title) || isSecretText(r.display_name) || isSecretText(r.name)) return true;
  if (isSecretText(r.sn) || isSecretText(r.snippet)) return true;
  if (r.year != null && r.kind) return false;
  if (r.typ === 'chapter' || r.kind === 'chapter' || r.kind === 'appendix' || r.kind === 'interlude') {
    return isSecretChapter(r);
  }
  return false;
};

/** 未解锁时用于 SQL 的实体过滤片段（t 为表别名，如 'e' 或 'e.'，均兼容）。配套参数见 ENTITY_GUARD_PARAMS。 */
export const entityGuardSql = (t = '') => {
  const p = t ? (t.endsWith('.') ? t : `${t}.`) : '';
  /* 父母卷（母亲/父亲/妈妈/爸爸 开头）的问卷文档型实体保持可见，其余问卷作答全文实体隐藏 */
  const parent = [...PARENT_LABELS].map(l => `COALESCE(${p}display_name,'') LIKE '${l}%'`).join(' OR ');
  return ` AND COALESCE(${p}std_id,'') NOT LIKE '%私人资料%' AND COALESCE(${p}std_id,'') NOT LIKE '%隐私%'`
    + ` AND COALESCE(${p}role_doc_path,'') NOT LIKE '%私人资料%' AND COALESCE(${p}role_doc_path,'') NOT LIKE '%隐私%'`
    + ` AND (COALESCE(${p}display_name,'') NOT LIKE '%${QUESTIONNAIRE_MARK}%' OR ${parent})`
    + ` AND (COALESCE(${p}role_doc_path,'') NOT LIKE '%${QUESTIONNAIRE_MARK}%' OR ${parent})`;
};
export const ENTITY_GUARD_PARAMS = [];

/** 未解锁时用于 SQL 的文档过滤片段（t 为表别名前缀）。无占位符，可直接内联。 */
export const docGuardSql = (t = '') => {
  const p = t ? `${t}.` : '';
  return ` AND ${p}is_private=0 AND ${p}path NOT LIKE '%${QUESTIONNAIRE_MARK}%'`
    + ` AND COALESCE(${p}path,'') NOT LIKE '%私人资料%' AND COALESCE(${p}path,'') NOT LIKE '%隐私%'`;
};

/** 未解锁时用于 SQL 的时间线过滤片段（t 为表别名前缀） */
export const timelineGuardSql = (_t = '') => '';

/** 未解锁时用于 SQL 的章节过滤片段（doc_path 落在私密层或标题点名绝密者剔除） */
export const chapterGuardSql = () =>
  ` AND COALESCE(doc_path,'') NOT LIKE '%私人资料%' AND COALESCE(doc_path,'') NOT LIKE '%隐私%'`;

/** 未解锁时用于 SQL 的意象过滤片段 */
export const imageryGuardSql = () => '';

/** 未解锁时用于 SQL 的问卷过滤片段（只留父母卷） */
export const questionnaireGuardSql = () => ` AND respondent_label IN ('母亲','父亲','爸爸','妈妈')`;

const META_BAD = new RegExp(
  ['私人资料', '隐私\\/', '问卷作答全文'].join('|'),
);
/** 元数据脱敏：公开文档的 frontmatter（related/persons/themes 等）里可能引用私密或绝密路径，
 *  未解锁时递归剔除这些字符串——否则「正文锁住了、元数据把路径漏出去」。
 *  实测命中：大学/四川大学/强基班/人物/教师/陶军.md 的 meta.related 指向 V3 问卷作答全文；
 *  小学/小学阶段人物与素材索引.md 的 meta.persons 指向 私人资料/…（私密）。 */
export const scrubMeta = (meta, unlocked) => {
  if (unlocked || meta == null || typeof meta !== 'object') return meta;
  const walk = (v) => {
    if (typeof v === 'string') return META_BAD.test(v) ? undefined : v;
    if (Array.isArray(v)) return v.map(walk).filter(x => x !== undefined && x !== '' && !(Array.isArray(x) && !x.length));
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, val] of Object.entries(v)) {
        const w = walk(val);
        if (w !== undefined && w !== '' && !(Array.isArray(w) && !w.length)) o[k] = w;
      }
      return o;
    }
    return v;
  };
  return walk(meta);
};

/** 伏应台账：未解锁时不得带出绝密姓名、私密路径 */
export const sanitizeForeshadow = (rows, unlocked) => {
  if (unlocked) return rows || [];
  return (rows || []).filter(r => {
    const blob = [r.material, r.plant, r.harvest, r.method, r.status].map(v => String(v || '')).join('\n');
    return !isSecretText(blob) && !isPrivatePath(blob);
  });
};

/** 检索结果的最后一道出口净化（纵深防御，供 store.mjs / store-pg.mjs 共用） */
export const sanitizeGroups = (groups, unlocked) => {
  if (unlocked) return groups;
  for (const k of Object.keys(groups)) {
    groups[k] = (groups[k] || []).filter(r => {
      const p = r.path || r.doc_path || r.std_id || '';
      return !isPrivatePath(p);
    }).map(r => {
      const o = { ...r };
      if (isLockedStub(o)) {
        o.locked = true;
        o.sn = '';
        o.snippet = '';
      }
      return o;
    });
  }
  return groups;
};
