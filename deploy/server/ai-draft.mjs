/**
 * ΜΝΗΜΗ · 写作助手
 * 有 MNEME_AI_KEY 时走兼容 OpenAI 的 Chat Completions；否则用本地脚手架。
 * 不读私密层，不把未提供的感官写成亲历。
 */
const SYSTEM = `你是刘佑林自传《ΜΝΗΜΗ》的写作助手。事实为骨架，散文为肌理，小说技法只管节奏。
硬性约束：
1. 只根据用户给出的正文、选区和指令写。不得编造未给出的天气、气味、动作、对白、心理和他人动机。
2. 材料不够就整段标【待采】或【有界推演】，并用 > [!推演] 包住推演句。定稿不得去掉这些标记，不得伪装成亲历记忆。
3. 亲历的我／回望的我必须分开。亲历者不得提前知道后来的信息。
4. 不得写入私人资料路径、精确住址、电话、证件号、第三方私密原话。
5. 不得把问卷评价、提及次数写成人格或关系结论。不得推测赵问竹等人物的情感态度。
6. 不模仿具体作家的独特文风。不强行升华结尾。
7. 只输出 Markdown 正文，不要解释你做了什么。`;

const localContinue = (src, instruction) => {
  const last = src.trim().split(/\n{2,}/).filter(Boolean).slice(-2).join('\n\n');
  const extra = instruction ? `\n\n（作者指令：${instruction.slice(0, 120)}）` : '';
  return `${last}${extra}\n\n【待采】下一拍还没有从材料核实。回望的我停在已经看见的动作上，不补天气、对白或别人心里在想什么。\n\n> [!待采]\n> 缺：可核时间、在场者、当场物件、说话人原话。有了再写，不要先写成亲历。\n`;
};

const localPolish = (src) => src
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{4,}/g, '\n\n\n')
  .replace(/([。！？]){3,}/g, '$1$1')
  .trim() + '\n';

const localExpand = (src) => {
  const lines = src.split('\n').filter(l => /^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l));
  if (!lines.length) return localContinue(src);
  return lines.map((l) => {
    const t = l.replace(/^\s*[-*\d.]+\s+/, '').trim();
    return `${t}\n\n【待采】这一点目前只有提纲。场景、对白和他人反应都还没有材料，先留下位置。\n`;
  }).join('\n');
};

export const localDraft = ({ text = '', mode = 'continue', instruction = '', selection = '' }) => {
  const src = (selection || text).slice(-4000);
  if (mode === 'polish') return localPolish(src);
  if (mode === 'expand') return localExpand(src);
  return localContinue(src, instruction);
};

export const hasLlm = () => !!String(process.env.MNEME_AI_KEY || '').trim();

export async function llmDraft({ text = '', mode = 'continue', instruction = '', selection = '', title = '' }) {
  const key = String(process.env.MNEME_AI_KEY || '').trim();
  if (!key) return { text: localDraft({ text, mode, instruction, selection }), engine: 'local' };
  const base = String(process.env.MNEME_AI_BASE || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.MNEME_AI_MODEL || 'gpt-4o-mini';
  const user = [
    title ? `篇名：${title}` : '',
    `任务：${mode === 'polish' ? '润色，不增事实' : mode === 'expand' ? '按提纲扩写，缺材料处标待采' : '续写下一拍'}`,
    instruction ? `作者指令：${instruction.slice(0, 400)}` : '',
    selection ? `选区：\n${selection.slice(0, 3000)}` : '',
    `正文（节选）：\n${(selection ? '' : text).slice(-6000)}`,
  ].filter(Boolean).join('\n\n');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!r.ok) throw new Error(`ai ${r.status}`);
    const j = await r.json();
    const out = j?.choices?.[0]?.message?.content;
    if (typeof out !== 'string' || !out.trim()) throw new Error('empty');
    return { text: out.trim() + '\n', engine: 'llm' };
  } catch {
    return { text: localDraft({ text, mode, instruction, selection }), engine: 'local' };
  } finally {
    clearTimeout(t);
  }
}
