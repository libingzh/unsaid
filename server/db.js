// 数据层:封装成可替换的接口。现在用 SQLite,将来换 MySQL 只改本文件。
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function hashPw(pw){ return crypto.createHash('sha256').update(String(pw)).digest('hex'); }

const DB_PATH = process.env.UNSAID_DB || path.join(__dirname, 'data', 'chat.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
// WAL 模式在正常磁盘上能提升并发读写;个别文件系统不支持,失败则回退默认模式。
try { db.pragma('journal_mode = WAL'); } catch (e) { console.warn('WAL 不可用,使用默认日志模式'); }

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    room   TEXT NOT NULL,
    sender TEXT NOT NULL,
    text   TEXT NOT NULL,
    ts     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_room_ts ON messages(room, ts);
`);

// 迁移:给已有旧库补列(重复执行会报错,忽略即可)
try { db.exec("ALTER TABLE messages ADD COLUMN avatar TEXT DEFAULT '💬'"); } catch (e) {}
try { db.exec("ALTER TABLE messages ADD COLUMN uid TEXT DEFAULT ''"); } catch (e) {}

// 房间表:记录每个房间的密码哈希(首位进入者设定)
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    room     TEXT PRIMARY KEY,
    pw_hash  TEXT NOT NULL,
    created  INTEGER NOT NULL
  );
`);

module.exports = {
  // 校验/初始化房间密码。返回 { ok, reason, created }
  //  - 房间不存在:创建并设为该密码(created=true)
  //  - 房间存在:密码匹配才 ok
  checkRoom(room, pw) {
    room = String(room || '').trim();
    pw = String(pw || '');
    if (!room) return { ok: false, reason: 'no_room' };
    if (!pw) return { ok: false, reason: 'no_pw' };
    const row = db.prepare('SELECT pw_hash FROM rooms WHERE room = ?').get(room);
    if (!row) {
      db.prepare('INSERT INTO rooms (room, pw_hash, created) VALUES (?, ?, ?)')
        .run(room, hashPw(pw), Date.now());
      return { ok: true, created: true };
    }
    if (row.pw_hash === hashPw(pw)) return { ok: true, created: false };
    return { ok: false, reason: 'wrong_pw' };
  },
  roomExists(room) {
    return !!db.prepare('SELECT 1 FROM rooms WHERE room = ?').get(String(room || '').trim());
  },

  addMessage(room, sender, text, avatar, uid) {
    const ts = Date.now();
    const av = avatar || '💬';
    const u = uid || '';
    const info = db.prepare(
      'INSERT INTO messages (room, sender, text, ts, avatar, uid) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(room, sender, text, ts, av, u);
    return { id: info.lastInsertRowid, room, sender, text, ts, avatar: av, uid: u };
  },
  getHistory(room, limit = 1000) {
    return db.prepare(
      'SELECT id, sender, text, ts, avatar, uid FROM messages WHERE room = ? ORDER BY ts ASC LIMIT ?'
    ).all(room, limit);
  },
  exportAll(room) {
    if (room) {
      return db.prepare(
        'SELECT room, sender, text, ts, avatar, uid FROM messages WHERE room = ? ORDER BY ts ASC'
      ).all(room);
    }
    return db.prepare(
      'SELECT room, sender, text, ts, avatar, uid FROM messages ORDER BY room, ts ASC'
    ).all();
  },
  stats(room) {
    return db.prepare(
      'SELECT COUNT(*) AS n, MIN(ts) AS first, MAX(ts) AS last FROM messages WHERE room = ?'
    ).get(room);
  }
};
