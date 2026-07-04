// 回忆模式的大模型接入(Claude / Anthropic)
// 设计:RAG —— 用检索到的"TA 说过的相关原话"作为参考,让模型模仿 TA 的语气生成回应。
// 安全:未配置 API key 时返回 null,由调用方自动回退到纯检索模式。
const https = require('https');

const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.UNSAID_MODEL || 'claude-3-5-haiku-latest'; // 便宜够用,可换 sonnet
const ENABLED = !!API_KEY;

// ---- 服务端检索:从消息里找出 TA 说过的、与输入最相关的话 ----
function clean(s){ return (s||'').replace(/[\s,。,.!！?？、~…"'':：;；()（）]/g,''); }
function grams(s,n){ s=clean(s); const g={}; if(s.length<n){ if(s)g[s]=1; return g; } for(let i=0;i<=s.length-n;i++)g[s.substr(i,n)]=1; return g; }
function jac(ga,gb){ const ka=Object.keys(ga),kb=Object.keys(gb); if(!ka.length||!kb.length)return 0; let n=0; ka.forEach(k=>{ if(gb[k])n++; }); return n/(ka.length+kb.length-n); }
function sim(a,b){ return 0.65*jac(grams(a,2),grams(b,2)) + 0.35*jac(grams(a,1),grams(b,1)); }

// messages: [{who:'me'|'ta', text}] (相对"回忆发起者"而言)
// 返回最相关的若干条 TA 原话
function retrieveContext(messages, input, topK = 6){
  const taLines = messages.filter(m => m.who === 'ta').map(m => m.text);
  const scored = taLines.map(t => ({ t, s: sim(input, t) }));
  scored.sort((a,b) => b.s - a.s);
  const top = scored.filter(x => x.s > 0.05).slice(0, topK).map(x => x.t);
  // 兜底:相关度都很低时,取最近若干条 TA 原话,给模型一点语气样本
  if (top.length < 3) {
    const recent = taLines.slice(-topK);
    recent.forEach(t => { if (!top.includes(t)) top.push(t); });
  }
  return top.slice(0, topK);
}

// ---- 调 Claude 生成回应 ----
// taName: TA 的名字;samples: TA 真实说过的话(风格与素材);history: 最近对话;input: 用户当前输入
function callClaude({ taName, samples, recentPairs, input }) {
  return new Promise((resolve, reject) => {
    const sys =
`你是一个"记忆回响"角色扮演助手。你要模仿一个名叫「${taName}」的人的说话语气和用词,回应对方。

重要规则(必须遵守):
1. 只模仿「${taName}」的语气、口头禅、用词习惯来回应,像 TA 平时那样说话。
2. 你不是真人,不能假装自己"真的是 TA"或"人还在/还能回来"。如果对方直接问"你是不是真的 TA""你还活着吗"之类,要温柔但诚实地说明你只是基于记忆的回声。
3. 回应要短、自然、口语化,像日常聊天,一般一到三句话。不要长篇大论,不要像客服或 AI。
4. 参考下面「${taName}」真实说过的话,尽量贴近那种语气和称呼方式。
5. 不要编造具体的、可能造成误导的事实承诺(比如"我明天来看你")。

下面是「${taName}」真实说过的一些话(供你学习语气,不要原样照抄):
${samples.map(s => '「' + s + '」').join('\n')}`;

    const userMsgs = [];
    (recentPairs || []).forEach(p => {
      if (p.q) userMsgs.push({ role: 'user', content: p.q });
      if (p.a) userMsgs.push({ role: 'assistant', content: p.a });
    });
    userMsgs.push({ role: 'user', content: input });

    const body = JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system: sys,
      messages: userMsgs
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.error) return reject(new Error(j.error.message || 'api error'));
          const text = (j.content && j.content[0] && j.content[0].text || '').trim();
          resolve(text || null);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

module.exports = { ENABLED, MODEL, retrieveContext, callClaude };
