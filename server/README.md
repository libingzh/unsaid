# Unsaid 联网后端

Node + Express + WebSocket + SQLite。实时双人聊天,消息存服务器,支持导出。

## 本地运行

```bash
cd server
npm install
EXPORT_KEY=你的密钥 node server.js
# 浏览器打开 http://localhost:3000,两个窗口填同一房间号即可实时聊天
```

## 部署到阿里云(Ubuntu/CentOS 轻量服务器)

1. 装 Node:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt install -y nodejs      # CentOS 用 yum
   ```
2. 传代码(git clone/scp),`cd unsaid/server && npm install`
3. pm2 常驻:
   ```bash
   sudo npm install -g pm2
   EXPORT_KEY=你的强密钥 PORT=3000 pm2 start server.js --name unsaid
   pm2 save && pm2 startup
   ```
4. 阿里云安全组放行端口(3000)。
5. 访问 `http://服务器IP:3000`。建议配域名 + HTTPS(Nginx 反代 + Let's Encrypt)。

## 环境变量

- `PORT`:端口,默认 3000
- `EXPORT_KEY`:导出密钥,**务必改**
- `UNSAID_DB`:数据库路径,默认 `server/data/chat.db`

## 拿回聊天记录做迭代

导出接口(浏览器直接打开下载),三种格式:

- **json**(全字段,存档/程序处理):`http://IP:3000/export?key=密钥&format=json[&room=房间号]`
- **txt**(带时间戳,人看):`http://IP:3000/export?key=密钥&format=txt&room=房间号`
- **chat**(`我:/对方:` 格式,可直接粘进检索工具/回忆模式):
  `http://IP:3000/export?key=密钥&format=chat&room=房间号&me=你的昵称`
  其中 `me=` 指定哪个发送者算"我",其余算"对方"。

迭代闭环:用 chat 格式导出 → 打开 `prototype/retrieval-tool.html` → 粘贴 → 即可用真实记录测试"像不像 TA"。

也可直接拉数据库文件回本地:`scp root@IP:/path/unsaid/server/data/chat.db ./`

## 数据库

表 `messages(id, room, sender, text, ts)`。数据层封装在 `db.js`,将来换 MySQL 只改这一个文件。
