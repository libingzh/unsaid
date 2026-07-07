// Unsaid（未尽）联网后端
// 静态托管前端 + WebSocket 实时聊天 + SQLite 存储 + 数据导出接口
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const db = require('./db');
const llm = require('./llm');

// 回忆模式对话日志(用于优化):每行一条 JSON,存到 server/data/memory_log.jsonl
const LOG_PATH = path.join(__dirname, 'data', 'memory_log.jsonl');
fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
function logMemoryTurn(entry) {
  const id = crypto.randomBytes(6).toString('hex');
  const rec = Object.assign({ id, ts: Date.now(), score: 0 }, entry);
  try { fs.appendFileSync(LOG_PATH, JSON.stringify(rec) + '\n'); } catch (e) {}
  return id;
}
function setFeedback(logId, score) {
  // 简单实现:整文件读入→改该行→写回(个人项目量级足够)
  let lines;
  try { lines = fs.readFileSync(LOG_PATH, 'utf8').split('\n'); } catch (e) { return false; }
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try {
      const o = JSON.parse(lines[i]);
      if (o.id === logId) { o.score = score; o.rated_ts = Date.now(); lines[i] = JSON.stringify(o); changed = true; break; }
    } catch (e) {}
  }
  if (changed) { try { fs.writeFileSync(LOG_PATH, lines.join('\n')); } catch (e) {} }
  return changed;
}

const PORT = process.env.PORT || 3000;
// 导出接口密钥,防止别人随便下载聊天记录。部署时改成你自己的。
const EXPORT_KEY = process.env.EXPORT_KEY || 'change-me-please';

const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 回忆模式生成接口:前端把 TA 的相关语料 + 当前输入发来,后端用 Claude 模仿 TA 语气回应。
// 未配置 API key(llm.ENABLED=false)时返回 {mode:'retrieval'},由前端回退纯检索。
app.post('/memory-reply', async (req, res) => {
  try {
    const taName = String((req.body && req.body.taName) || 'TA').slice(0, 40);
    const input = String((req.body && req.body.input) || '').slice(0, 1000);
    const messages = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
    if (!input.trim()) return res.json({ mode: 'error', reply: '' });
    if (!llm.ENABLED) return res.json({ mode: 'retrieval' }); // 未配 key,让前端走本地检索

    const samples = llm.retrieveContext(messages, input, 6);
    // 取最近几组问答做上下文(相对回忆发起者:who==='me' 是用户,'ta' 是对方)
    const recentPairs = [];
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].who === 'ta') {
        const q = (i > 0 && messages[i-1].who === 'me') ? messages[i-1].text : '';
        recentPairs.push({ q, a: messages[i].text });
      }
    }
    const reply = await llm.callClaude({ taName, samples, recentPairs: recentPairs.slice(-4), input });
    if (!reply) return res.json({ mode: 'retrieval' });
    // 记录这次问答,供优化用;返回 logId 供前端回传评分
    const logId = logMemoryTurn({ taName, input, samples, reply, provider: llm.PROVIDER, model: llm.MODEL });
    res.json({ mode: 'llm', reply, logId });
  } catch (e) {
    // 出错也回退检索,保证可用
    res.json({ mode: 'retrieval', error: String(e.message || e) });
  }
});

// 评分反馈:前端点 👍/👎 时回传,写回对应日志条目
app.post('/memory-feedback', (req, res) => {
  const logId = String((req.body && req.body.logId) || '');
  const score = Number((req.body && req.body.score) || 0);
  if (!logId) return res.json({ ok: false });
  const ok = setFeedback(logId, score);
  res.json({ ok });
});

// 回忆模式训练日志导出(含每次问答与你的评分),用于优化模型
// /memory-log?key=密钥
app.get('/memory-log', (req, res) => {
  if (req.query.key !== EXPORT_KEY) return res.status(403).send('forbidden: 密钥不对');
  let content = '';
  try { content = fs.readFileSync(LOG_PATH, 'utf8'); } catch (e) { content = ''; }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="memory_log.jsonl"');
  res.send(content);
});

// 数据导出接口(拿回本地做迭代)
// json:  /export?key=密钥&format=json[&room=房间号]
// txt:   /export?key=密钥&format=txt&room=房间号
app.get('/export', (req, res) => {
  if (req.query.key !== EXPORT_KEY) return res.status(403).send('forbidden: 密钥不对');
  const room = req.query.room || '';
  const rows = db.exportAll(room || undefined);
  const format = req.query.format || 'json';

  // txt:带时间戳的可读文本(存档用)
  if (format === 'txt') {
    const lines = rows.map(r => `[${new Date(r.ts).toLocaleString()}] ${r.sender}: ${r.text}`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="unsaid_export.txt"');
    return res.send(lines.join('\n'));
  }

  // chat:无时间戳的"发送者: 内容",可直接粘进检索工具/回忆模式
  // 可选 ?me=昵称 把该发送者标为"我",其余标为"对方",便于检索工具区分角色
  if (format === 'chat') {
    const me = (req.query.me || '').trim();
    const lines = rows.map(r => {
      const role = me ? (r.sender === me ? '我' : '对方') : r.sender;
      return `${role}: ${r.text}`;
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="unsaid_chat.txt"');
    return res.send(lines.join('\n'));
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="unsaid_export.json"');
  res.send(JSON.stringify(rows, null, 2));
});

app.get('/health', (req, res) => res.json({ ok: true, time: Date.now() }));

// WebSocket 实时聊天
const wss = new WebSocketServer({ server });
const clients = new Map(); // ws -> { room, name }

function broadcast(room, payload) {
  const data = JSON.stringify(payload);
  for (const [ws, meta] of clients) {
    if (meta.room === room && ws.readyState === ws.OPEN) ws.send(data);
  }
}

wss.on('connection', (ws) => {
  clients.set(ws, { room: null, name: null });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (msg.type === 'join') {
      const room = String(msg.room || '').trim();
      const pw = String(msg.pw || '');
      const name = String(msg.name || '匿名').trim() || '匿名';
      // 校验房间密码(首次进入即设定密码)
      const chk = db.checkRoom(room, pw);
      if (!chk.ok) {
        ws.send(JSON.stringify({ type: 'join_denied', reason: chk.reason }));
        return;
      }
      // 身份 = 房间 + 名称。同名即同一个人(同一 uid),允许多设备(电脑+手机)同时在线。
      // 不再因同名拒绝,以支持同一个人跨设备登录。
      const meta = {
        room: room,
        name: name,
        avatar: String(msg.avatar || '💬').slice(0, 60000), // emoji 或 上传图片的 base64
        uid: room + '::' + name   // 身份标识:房间+名称
      };
      clients.set(ws, meta);
      ws.send(JSON.stringify({ type: 'join_ok', created: !!chk.created, uid: meta.uid }));
      const history = db.getHistory(meta.room);
      ws.send(JSON.stringify({ type: 'history', messages: history }));
      // 把房间内所有在线成员(含刚进来的自己)的头像发给新来的人
      const members = [];
      for (const [, m] of clients) {
        if (m.room === meta.room && m.uid) members.push({ uid: m.uid, name: m.name, avatar: m.avatar });
      }
      ws.send(JSON.stringify({ type: 'members', members }));
      // 通知房间里其他人:我来了,这是我的头像
      broadcast(meta.room, { type: 'presence', uid: meta.uid, name: meta.name, avatar: meta.avatar });
      return;
    }
    if (msg.type === 'msg') {
      const meta = clients.get(ws);
      if (!meta || !meta.room) return;
      const text = String(msg.text || '').slice(0, 4000);
      if (!text.trim()) return;
      const saved = db.addMessage(meta.room, meta.name, text, meta.avatar, meta.uid);
      broadcast(meta.room, { type: 'msg', id: saved.id, sender: saved.sender, text: saved.text, ts: saved.ts, avatar: saved.avatar, uid: saved.uid });
    }
    // 聊天中修改头像:更新该连接的头像,并广播给房间,让对方实时刷新
    if (msg.type === 'set_avatar') {
      const meta = clients.get(ws);
      if (!meta || !meta.room) return;
      meta.avatar = String(msg.avatar || '💬').slice(0, 60000);
      clients.set(ws, meta);
      broadcast(meta.room, { type: 'presence', uid: meta.uid, name: meta.name, avatar: meta.avatar });
    }
  });
  function leave() {
    const meta = clients.get(ws);
    clients.delete(ws);
    if (meta && meta.room && meta.uid) {
      // 该 uid 是否还有其他在线连接(多标签页);没有才算真正离线
      let stillOnline = false;
      for (const [, m] of clients) {
        if (m.room === meta.room && m.uid === meta.uid) { stillOnline = true; break; }
      }
      if (!stillOnline) {
        broadcast(meta.room, { type: 'offline', uid: meta.uid, name: meta.name });
      }
    }
  }
  ws.on('close', leave);
  ws.on('error', leave);
});

server.listen(PORT, () => {
  console.log(`Unsaid server running on port ${PORT}`);
  console.log(`回忆模式大模型: ${llm.ENABLED ? llm.PROVIDER + ' (' + llm.MODEL + ')' : '未配置,使用纯检索'}`);
  console.log(`导出地址示例: http://localhost:${PORT}/export?key=${EXPORT_KEY}&format=json`);
});
