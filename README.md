# 🦞 OpenClaw Observer（Web 版）

**用浏览器监控 OpenClaw Gateway 状态。** 不需要安装，填写地址 + Token 就能用。

适合：自己架设了 OpenClaw、需要随时看状态的人。

---

## 效果预览

> **截图待补：部署后截一张发过来**

---

## 快速上手

### 第一步：确认你的 Gateway 能用

在运行 Gateway 的机器上执行：

```bash
curl http://127.0.0.1:18789/health
```

看到 JSON 返回就说明 Gateway 在跑。

### 第二步：找 Token

```bash
# 方法 A：配置文件里找
cat ~/.openclaw/openclaw.json | grep token
# 输出中 token 字段就是

# 方法 B：直接问 CLI
openclaw status 2>&1 | grep -i token
```

> ⚠️ **Token 是什么**：Gateway 的访问密钥，类

密码，**不要公开分享**。

### 第三步：启动 Web 服务

**在本机（Linux/Mac/Windows PowerShell）：**

```bash
# 克隆或下载项目
git clone https://github.com/Owen-Clarke/openclaw-observer-web
cd openclaw-observer-web

# 启动服务
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080
```

**手机访问（和电脑同一局域网）：**

1. 查电脑 IP：`ip addr | grep 192.168`
2. 浏览器打开 `http://电脑IP:8080`
3. 填入电脑 IP:18789 和 Token

**VPS/服务器：**

```bash
# 直接把端口暴露给局域网（或内网穿透）
python3 -m http.server 8080 --bind 0.0.0.0
```

### 第四步：填入连接信息

| 字段 | 填什么 |
|-------|--------|
| Gateway URL | `ws://127.0.0.1:18789`（本机）或 `ws://你的域名:18789`（远程） |
| Token | 上面第二步找到的 token |

点**连接**，看到卫星围绕轨道旋转 = 连上了。

---

## 远程连接（不在同机器上怎么办）

### 方案 A：SSH 隧道（推荐，最安全）

```bash
# 在本地 Mac/Linux/Windows PowerShell 执行
ssh -N -L 18789:127.0.0.1:18789 user@你的服务器IP
# 保持这个窗口开着
# 浏览器填 ws://127.0.0.1:18789
```

### 方案 B：内网穿透（如frp、自建 ngrok）

把 `ws://你的域名:18789` 填入 URL 栏。

### 方案 C：公网暴露（不推荐）

把 Gateway 端口 18789 改为监听 0.0.0.0，然后用 `wss://你的域名:18789` 直接连。**确保有 Token 保护**。

---

## 功能说明

| 功能 | 说明 |
|------|------|
| 轨道仪表面板 | Gateway 在线 = 绿色；离线 = 红色 |
| 状态摘要 | Telegram、Agent、任务、Token 用量一目了然 |
| 实时用量 | 追踪 Token 消耗增量 |
| 模型切换 | 下拉选模型，一键生效 |
| 会话列表 | 最近 8 条会话状态 |
| 24 格时间线 | 健康历史记录 |
| 配置记忆 | 填过的地址和 Token 存在浏览器本地

---

## 常见问题

**Q：连接不上，显示"连接关闭"**
A：
1. 地址是否填对（ws:// 不是 http://）
2. Token 是否正确
3. Gateway 是否还在跑（curl http://127.0.0.1:18789/health）
4. 防火墙是否开了 18789

**Q：Token 怎么找？**
A：在 Gateway 机器上运行 `openclaw status` 或查 `~/.openclaw/openclaw.json` 里的 `auth.token` 字段。

**Q：手机能用吗？**
A：可以。浏览器打开，用 SSH 隧道或内网穿透，PWA 可"添加到主屏幕"像 App 一样。

**Q：8080 端口被占用**
A：换端口：`python3 -m http.server 8081`（或其他未用端口）

**Q：连接成功但没数据**
A：Gateway 没有暴露对应 RPC 方法，或 Token 无权限。检查 Gateway 版本 >= 2026.4.21。

---

## 技术参数

- 纯前端，无依赖
- WebSocket 直连 Gateway（polling）
- 配置存浏览器 localStorage
- PWA 可离线缓存
- 更新：git pull + 刷新页面

---

## 与桌面版对比

| | Electron 桌面版 | Web 版 |
|--|--|--|
| 安装 | npm install + 200MB Electron | ❌ 不需要 |
| 系统要求 | 需要图形界面 | 任何浏览器 |
| 手机支持 | ❌ | ✅ |
| 更新 | 重新拉代码 | 刷新页面 |
| 离线使用 | ❌ | ✅（PWA 缓存后）|

---

## 开源协议

MIT
