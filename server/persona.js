// 虚拟对象性格库:计分(IPIP-50 大五 + ECR-S 依恋)、存储、注入 prompt。
// 见 docs/性格库设计方案.md。前端收集原始答案发来,后端计分并存 persona_<room>.json。
const fs = require('fs');
const path = require('path');

const DIR = process.env.UNSAID_DB ? path.dirname(process.env.UNSAID_DB) : path.join(__dirname, 'data');
fs.mkdirSync(DIR, { recursive: true });
function fileFor(room) {
  const safe = String(room || '').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80);
  return path.join(DIR, 'persona_' + safe + '.json');
}

// ---- IPIP-50 计分键:每维度 10 题,题号(1..50)对应 +/- ----
// 维度:E外向 A宜人 C尽责 ES情绪稳定 I才智
const IPIP_KEYS = {
  E:  [[1,1],[6,-1],[11,1],[16,-1],[21,1],[26,-1],[31,1],[36,-1],[41,1],[46,-1]],
  A:  [[2,-1],[7,1],[12,-1],[17,1],[22,-1],[27,1],[32,-1],[37,1],[42,1],[47,1]],
  C:  [[3,1],[8,-1],[13,1],[18,-1],[23,1],[28,-1],[33,1],[38,-1],[43,1],[48,1]],
  ES: [[4,-1],[9,1],[14,-1],[19,1],[24,-1],[29,-1],[34,-1],[39,-1],[44,-1],[49,-1]],
  I:  [[5,1],[10,-1],[15,1],[20,-1],[25,1],[30,-1],[35,1],[40,1],[45,1],[50,1]]
};
// ---- ECR-S 计分:12 题(1-7 分)。焦虑=1,2,3,4,6;回避=5,7,8,9R,10R,11R,12R ----
const ECR_ANX = [1,2,3,4,6];
const ECR_AVO_POS = [5,7,8];
const ECR_AVO_REV = [9,10,11,12]; // 反向:8-原分

// answers.ipip: {1..50: 1-5}  answers.ecr: {1..12: 1-7}
function scoreBigFive(ipip) {
  const out = {};
  for (const dim in IPIP_KEYS) {
    let sum = 0;
    IPIP_KEYS[dim].forEach(([q, dir]) => {
      let v = Number(ipip[q]) || 3;
      if (dir < 0) v = 6 - v;         // 反向:5->1
      sum += v;
    });
    // 10..50 → 0..100
    out[dim] = Math.round((sum - 10) / 40 * 100);
  }
  return out; // {E,A,C,ES,I}
}
function scoreAttachment(ecr) {
  let anx = 0, avo = 0;
  ECR_ANX.forEach(q => anx += (Number(ecr[q]) || 4));
  ECR_AVO_POS.forEach(q => avo += (Number(ecr[q]) || 4));
  ECR_AVO_REV.forEach(q => avo += (8 - (Number(ecr[q]) || 4)));
  const anxAvg = anx / ECR_ANX.length;               // 1..7
  const avoAvg = avo / (ECR_AVO_POS.length + ECR_AVO_REV.length);
  // 阈值 4.5(7分制略偏上,4=中性不算"高",减少误判为混乱型)
  const TH = 4.5;
  const highAnx = anxAvg >= TH, highAvo = avoAvg >= TH;
  let type = '安全型';
  if (highAnx && highAvo) type = '混乱型';
  else if (highAnx) type = '焦虑型';
  else if (highAvo) type = '回避型';
  return { anxiety: Math.round(anxAvg / 7 * 100), avoidance: Math.round(avoAvg / 7 * 100), type };
}

// 从原始问卷答案构建性格库
function buildPersona(payload) {
  const schema = payload.schema === 'B' ? 'B' : 'A';
  const base = {
    schema,
    identity: {
      name: String(payload.identity && payload.identity.name || 'TA').slice(0, 40),
      relation: String(payload.identity && payload.identity.relation || '').slice(0, 40),
      calls_user: String(payload.identity && payload.identity.calls_user || '').slice(0, 40),
      self_ref: String(payload.identity && payload.identity.self_ref || '我').slice(0, 20)
    },
    boundaries: ['不假装自己还活着/没分手', '不做具体承诺(如"我明天来")'],
    updated: Date.now()
  };
  if (schema === 'A') {
    base.big_five = scoreBigFive(payload.ipip || {});
    base.attachment = scoreAttachment(payload.ecr || {});
    base.values = Array.isArray(payload.values) ? payload.values.slice(0, 8) : [];
    base.speech_style = {
      tone: String(payload.tone || '').slice(0, 60),
      catchphrases: Array.isArray(payload.catchphrases) ? payload.catchphrases.slice(0, 10) : [],
      sentence_len: String(payload.sentence_len || '').slice(0, 20),
      emoji_habit: String(payload.emoji_habit || '').slice(0, 40)
    };
    base.memories = Array.isArray(payload.memories) ? payload.memories.slice(0, 20) : [];
  } else {
    // 方案 B:叙事卡(前端可传自然语言 + 情景题结果)
    base.one_liner = String(payload.one_liner || '').slice(0, 120);
    base.sketch = String(payload.sketch || '').slice(0, 2000);
    base.golden_lines = Array.isArray(payload.golden_lines) ? payload.golden_lines.slice(0, 20) : [];
    base.scene_reactions = Array.isArray(payload.scene_reactions) ? payload.scene_reactions.slice(0, 12) : [];
    // B 也可带一份精简人格底色(可选)
    if (payload.ipip) base.big_five = scoreBigFive(payload.ipip);
  }
  return base;
}

function savePersona(room, persona) {
  try { fs.writeFileSync(fileFor(room), JSON.stringify(persona, null, 2)); return true; }
  catch (e) { return false; }
}
function loadPersona(room) {
  try { return JSON.parse(fs.readFileSync(fileFor(room), 'utf8')); } catch (e) { return null; }
}

// 把性格库转成注入大模型的中文说明
function personaToPrompt(p) {
  if (!p) return '';
  const id = p.identity || {};
  if (p.schema === 'B') {
    let s = `你在扮演「${id.name}」`;
    if (id.relation) s += `(和对方的关系:${id.relation})`;
    s += '。\n';
    if (p.one_liner) s += `一句话:${p.one_liner}\n`;
    if (p.sketch) s += `${p.sketch}\n`;
    if (p.golden_lines && p.golden_lines.length) s += `TA 的经典口吻:${p.golden_lines.map(x => '「' + x + '」').join('、')}\n`;
    if (p.scene_reactions && p.scene_reactions.length) {
      s += '典型反应:' + p.scene_reactions.map(r => `当${r.when}时,${r.then}`).join(';') + '\n';
    }
    if (id.calls_user) s += `TA 称呼对方为「${id.calls_user}」。\n`;
    return s;
  }
  // 方案 A
  const bf = p.big_five || {};
  const lvl = (v) => v >= 66 ? '高' : (v <= 33 ? '低' : '中等');
  let s = `你在模仿「${id.name}」`;
  if (id.relation) s += `(和对方的关系:${id.relation})`;
  s += '。TA 的人格画像:';
  s += `外向性${lvl(bf.E)}、宜人性${lvl(bf.A)}、尽责性${lvl(bf.C)}、情绪稳定性${lvl(bf.ES)}(越低越敏感易委屈)、开放性${lvl(bf.I)}。`;
  if (p.attachment) s += `依恋类型:${p.attachment.type}。`;
  if (p.values && p.values.length) s += `在乎:${p.values.join('、')}。`;
  const st = p.speech_style || {};
  if (st.tone) s += `说话${st.tone}。`;
  if (st.catchphrases && st.catchphrases.length) s += `常说:${st.catchphrases.map(x => '「' + x + '」').join('、')}。`;
  if (id.calls_user) s += `称呼对方为「${id.calls_user}」。`;
  if (p.memories && p.memories.length) s += `可呼应的共同记忆:${p.memories.join(';')}。`;
  return s;
}

module.exports = { buildPersona, savePersona, loadPersona, personaToPrompt, scoreBigFive, scoreAttachment };
