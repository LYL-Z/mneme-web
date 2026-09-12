/**
 * 《补写的手册》文学目录解析。唯一来源：百万长文写作/目录.md
 * 部 / 辑 / 章 / 节 / 间。章号 1–60 固定。
 */
export const BOOKS = [
  { code: 'P0', seq: 0, name: '序·第十格', years: '回望', line_metaphor: '空下来的纸', mood: '定调', word_target: '0.8万', color_token: '#8A8378' },
  { code: 'B1', seq: 1, name: '第一部·空格', years: '2007—2019', line_metaphor: '格子', mood: '散点、白描', word_target: '12万', color_token: '#8FA38A' },
  { code: 'B2', seq: 2, name: '第二部·亲爱的', years: '2019—2022', line_metaphor: '信与笔', mood: '编年', word_target: '10万', color_token: '#B98A5E' },
  { code: 'B3', seq: 3, name: '第三部·桌上', years: '2022—2023 · G2204', line_metaphor: '答案放在桌上', mood: '留白', word_target: '16万', color_token: '#A86A6A' },
  { code: 'B4', seq: 4, name: '第四部·西侧', years: '2023—2025 · G2205', line_metaphor: '后门与灯', mood: '距离', word_target: '16万', color_token: '#6E8AA8' },
  { code: 'B5', seq: 5, name: '第五部·十七天', years: '2025', line_metaphor: '未拆的信', mood: '等待', word_target: '14万', color_token: '#C2A46B' },
  { code: 'B6', seq: 6, name: '第六部·保存', years: '2025—2026', line_metaphor: '键与光标', mood: '今昔', word_target: '9万', color_token: '#7A8F7A' },
  { code: 'AX', seq: 7, name: '附录·若当时', years: '非事实', line_metaphor: '走过去', mood: '反事实', word_target: '6万', color_token: '#9A8B7A' },
];

/** 人物调度：赵问竹加密度章。目录公开，点开走绝密弹窗。 */
export const SECRET_CHAPTER_SEQ = [23, 26, 27, 28, 29, 30, 31, 32, 33, 34, 39, 41, 48, 51, 57, 58, 59];
export const SECRET_INTERLUDES = new Set(['那一本', '灰', '后门']);
export const SECRET_APPENDIX = new Set(['走过去']);

const DIG = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
export const cnToInt = (s) => {
  const t = String(s || '').trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return +t;
  if (t === '十') return 10;
  if (t.startsWith('十')) return 10 + (DIG[t.slice(1)] ?? 0);
  if (t.endsWith('十') && t.length === 2) return (DIG[t[0]] ?? 0) * 10;
  if (t.includes('十')) {
    const [a, b] = t.split('十');
    return (DIG[a] ?? 0) * 10 + (DIG[b] ?? 0);
  }
  if (t in DIG) return DIG[t];
  const stem = { 甲: 1, 乙: 2, 丙: 3, 丁: 4 }[t];
  return stem ?? null;
};

const PART_CODE = {
  序: 'P0', 第十格: 'P0',
  第一部: 'B1', 空格: 'B1',
  第二部: 'B2', 亲爱的: 'B2',
  第三部: 'B3', 桌上: 'B3',
  第四部: 'B4', 西侧: 'B4',
  第五部: 'B5', 十七天: 'B5',
  第六部: 'B6', 保存: 'B6',
  附录: 'AX', 若当时: 'AX',
};

export const volumeOfRel = (rel) => {
  const p = String(rel || '').replace(/\\/g, '/');
  if (p.startsWith('百万长文写作/第一部') || p.includes('章稿/第一部')) return 'B1';
  if (p.startsWith('百万长文写作/第二部') || p.includes('章稿/第二部')) return 'B2';
  if (p.startsWith('百万长文写作/第三部') || p.includes('章稿/第三部')) return 'B3';
  if (p.startsWith('百万长文写作/第四部') || p.includes('章稿/第四部')) return 'B4';
  if (p.startsWith('百万长文写作/第五部') || p.includes('章稿/第五部')) return 'B5';
  if (p.startsWith('百万长文写作/第六部') || p.includes('章稿/第六部')) return 'B6';
  if (p.includes('章稿/附录') || p.startsWith('百万长文写作/附录')) return 'AX';
  if (p.includes('核心稿/')) {
    if (/间章-那一本|间章-灰/.test(p)) return 'B3';
    if (/间章-后门/.test(p)) return 'B4';
    const cm = p.match(/核心稿\/(?:间章-)?([一二三四五六七八九十百]+)/);
    if (cm) return bookOfChapter(cnToInt(cm[1])) || 'P0';
  }
  if (p.startsWith('百万长文写作/')) return 'P0';
  if (p.startsWith('长篇创作/章节设计-第一卷') || p.startsWith('长篇创作/试写/序章')) return 'B1';
  if (p.startsWith('长篇创作/章节设计-第二卷')) return 'B2';
  if (p.startsWith('长篇创作/章节设计-第三卷') || p.startsWith('长篇创作/试写/第三卷')) return 'B3';
  if (p.startsWith('长篇创作/章节设计-第四卷')) return 'B4';
  if (p.startsWith('长篇创作/章节设计-第五卷') || p.startsWith('长篇创作/试写/第五卷')) return 'B6';
  return null;
};

export const bookOfChapter = (seq) => {
  if (seq >= 1 && seq <= 12) return 'B1';
  if (seq >= 13 && seq <= 22) return 'B2';
  if (seq >= 23 && seq <= 32) return 'B3';
  if (seq >= 33 && seq <= 44) return 'B4';
  if (seq >= 45 && seq <= 52) return 'B5';
  if (seq >= 53 && seq <= 60) return 'B6';
  return null;
};

const DRAFT_OF = {
  P0: '百万长文写作/章稿/00-读法.md',
  B1: '百万长文写作/章稿/第一部-空格.md',
  B2: '百万长文写作/章稿/第二部-亲爱的.md',
  B3: '百万长文写作/章稿/第三部-桌上.md',
  B4: '百万长文写作/章稿/第四部-西侧.md',
  B5: '百万长文写作/章稿/第五部-十七天.md',
  B6: '百万长文写作/章稿/第六部-保存.md',
  AX: '百万长文写作/章稿/附录-若当时.md',
};

export const parseCatalog = (text) => {
  const chapters = [];
  let code = 'P0';
  let fascicle = '';
  let fascSeq = 0;
  let interlude = 0;
  let cur = null;

  const flush = () => { if (cur) chapters.push(cur); cur = null; };

  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    const part = line.match(/^#\s+(第[一二三四五六]部|附录)[　\s]+(.+)$/);
    if (part) {
      flush();
      code = PART_CODE[part[1]] || 'P0';
      fascicle = '';
      continue;
    }
    const preface = line.match(/^##\s+序[　\s]+(.+)$/);
    if (preface) {
      flush();
      code = 'P0';
      fascicle = preface[1].trim();
      fascSeq = 0;
      cur = {
        volume_code: 'P0',
        seq: 0,
        title: fascicle,
        fascicle,
        fasc_seq: 0,
        kind: 'preface',
        sections: [],
        secret: 0,
        doc_path: DRAFT_OF.P0,
        status: '目录',
        is_sample: 0,
      };
      continue;
    }
    const fasc = line.match(/^##\s+辑([一二三四五六七八九十]+)[　\s]+(.+)$/);
    if (fasc) {
      flush();
      fascicle = fasc[2].trim();
      fascSeq = cnToInt(fasc[1]) || ++fascSeq;
      continue;
    }
    const ch = line.match(/^###\s+([一二三四五六七八九十百]+|[甲乙丙丁])[　\s]+(.+)$/);
    if (ch) {
      flush();
      const n = cnToInt(ch[1]);
      const title = ch[2].trim();
      const kind = code === 'AX' ? 'appendix' : code === 'P0' ? 'preface' : 'chapter';
      const seq = kind === 'appendix' ? (n || chapters.filter(c => c.volume_code === 'AX').length + 1) : (n ?? 0);
      const secret = kind === 'chapter' && SECRET_CHAPTER_SEQ.includes(seq)
        || kind === 'appendix' && SECRET_APPENDIX.has(title);
      cur = {
        volume_code: code,
        seq,
        title,
        fascicle,
        fasc_seq: fascSeq,
        kind,
        sections: [],
        secret: secret ? 1 : 0,
        doc_path: DRAFT_OF[code] || null,
        status: '目录',
        is_sample: 0,
      };
      continue;
    }
    const inter = line.match(/^\*\*间[　\s]+(.+)\*\*$/);
    if (inter) {
      flush();
      const title = inter[1].trim();
      interlude += 1;
      chapters.push({
        volume_code: code,
        seq: 1000 + interlude,
        title,
        fascicle,
        fasc_seq: fascSeq,
        kind: 'interlude',
        sections: [],
        secret: SECRET_INTERLUDES.has(title) ? 1 : 0,
        doc_path: DRAFT_OF[code] || null,
        status: '间章',
        is_sample: 0,
      });
      continue;
    }
    const sec = line.match(/^[-*]\s+(.+)$/);
    if (sec && cur) cur.sections.push(sec[1].trim());
  }
  flush();
  return chapters;
};

export const parseForeshadow = (text) => {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!/^\|\s*\d+/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 5 || cells[0] === '#') continue;
    rows.push({
      id: +cells[0],
      level: '青铜',
      material: cells[1],
      plant: cells[2],
      harvest: cells[3],
      method: cells[4] || '',
      status: '现行',
    });
  }
  return rows;
};
