# 🦞 OpenClaw Observer (Web)

> **实时监控 OpenClaw Gateway 运行状态。** 浏览器打开就能用。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

一个纯前端的状态面板，通过 WebSocket 直连 OpenClaw Gateway，查看网关状态、Telegram 连接、活跃会话、任务队列、模型和 Token 用量。

不需要安装任何东西，一个 `index.html` + 一个 `app.js`，任何设备都能跑。

---

## 截图

_（等你部署后截图发过来）_

---

## 快速使用

### 方式一：直接打开（最简单）

```bash
git clone https://github.com/你的用户名/openclaw-observer-web
cd openclaw-observer-web
python3 -m http.server 8080
```

浏览器打开 `http://localhost:8080`，输入 Gateway 地址和 Token，点连接。

### 方式二：单文件打开

用 VS Code 的 Live Server 插件，或者直接把 `index.html` 拖到浏览器（部分浏览器会限制 WebSocket）。

### 方式三：Docker

```bash
docker run -d -p 8080:80 -v $(pwd):/usr/share/nginx/html:ro nginx:alpine
```

---

## 配置

| 参数 | 说明 | 默认值 |
|------|------|--------|
| Gateway URL | WebSocket 地址 | `ws://127.0.0.1:18789` |
| Gateway Token | 从 Gateway 获取 | `openclaw-2026` |

在同一台机器上运行：直接填 `ws://127.0.0.1:18789`。
远程连接：SSH 隧道或 VPN。

### SSH 隧道示例

```bash
# Windows/Linux/Mac 都支持
ssh -N -L 18789:127.0.0.1:18789 user@your-server
```

然后浏览器访问 `http://localhost:8080`，Gateway 地址填 `ws://127.0.0.1:18789`。

---

## 功能

- ✅ **实时仪表盘** — Gateway 健康、Telegram 状态、Agent 信息、任务队列
- ✅ **Token 用量** — 当前会话、累计 Token、实时增量
- ✅ **模型切换** — 下拉框选模型，一键切换并重启 Gateway
- ✅ **活跃会话** — 前 8 条会话（状态、时间、模型）
- ✅ **24 格时间线** — 过去 24 次轮询的健康状态
- ✅ **评分系统** — 0-100 健康评分，一目了然
- ✅ **配置记忆** — URL 和 Token 保存在浏览器 localStorage
- ✅ **PWA 支持** — 手机端添加到主屏幕，像原生 App

---

## 技术原理

```
浏览器 ── WebSocket ──→ OpenClaw Gateway (ws://host:18789)
```

Gateway 暴露 WebSocket 接口，Observer 通过标准 RPC 协议获取状态数据：

| RPC 方法 | 数据 |
|----------|------|
| `health` | Gateway 健康检查、插件列表、Agent |
| `channels.status` | Telegram 等渠道状态 |
| `status` | 任务队列（运行/排队/失败） |
| `sessions.list` | 活跃会话列表 |
| `usage.status` | Provider Token 消耗 |
| `models.list` | 可用模型列表（用于切换） |
| `config.get` | 当前配置（用于识别当前模型） |
| `config.patch` | 修改配置（切换模型） |

---

## 与 Electron 版的区别

| | Electron 版 | Web 版 |
|---|---|---|
| 安装 | 需要 npm install + 200MB Electron | ❌ 不需要 |
| GPU | 需要（Linux 易翻车）| ❌ 不需要 |
| 手机 | ❌ 不支持 | ✅ 浏览器 + PWA |
| 跨平台 | Win/Mac/Linux | 任何有浏览器的设备 |
| 配置存储 | 本地文件 | 浏览器 localStorage |
| 更新 | 需要重新拉代码 | 刷新即最新 |
| 离线 | 不支持 | PWA 可配置 |

---

## 开源协议

MIT
