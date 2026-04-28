/* OpenClaw Observer — Web Version */
/* Standalone browser app, no Electron dependency */

const DEFAULT_CONFIG = {
  gatewayUrl: "ws://127.0.0.1:18789",
  gatewayToken: "",
  pollMs: 5000
};

const CONFIG_KEY = "openclaw-observer-config";

const state = {
  ws: null,
  connected: false,
  connecting: false,
  ready: false,
  pending: new Map(),
  config: { ...DEFAULT_CONFIG },
  pollTimer: null,
  polling: false,
  timeline: [],
  lastHealth: null,
  lastChannels: null,
  lastStatus: null,
  lastConfig: null,
  lastModels: null,
  lastSessions: null,
  lastUsage: null,
  lastSessionUsage: null,
  tokenSample: null,
  tokenDelta: 0,
  slowPolling: false,
  lastSlowPollAt: 0,
  instanceId: crypto.randomUUID()
};

const $ = (id) => document.getElementById(id);

const els = {};
const elIds = [
  "gatewayUrl","gatewayToken","connectBtn","disconnectBtn","saveBtn","clearLogBtn","refreshBtn",
  "applyModelBtn","modelSelect","modelSavedAt","modelHint","statusPill","statusText","headline",
  "headlineDetail","heroStatus","heroDetail","coreScore","coreCaption","coreScoreSmall","coreCaptionSmall",
  "overviewGateway","overviewGatewayDetail","overviewTelegram","overviewTelegramDetail","overviewAgent",
  "overviewAgentDetail","overviewTasks","overviewTasksDetail","workState","workDetail","workPrimary",
  "activeModel","activeSession","activeTasks","activeSubagents","activeUsage","cardGateway","cardTelegram",
  "cardAgent","cardTasks","metricGateway","metricTelegram","metricPlugins","metricTasks","summary",
  "eventLog","timeline","lastSeen","orbitalWrap","overview"
];
elIds.forEach(id => { els[id] = $(id); });

/* ─── UTILITY FUNCTIONS ─── */

function nowTime() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function normalizeGatewayUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return DEFAULT_CONFIG.gatewayUrl;
  if (value.startsWith("http://")) return value.replace(/^http:\/\//, "ws://");
  if (value.startsWith("https://")) return value.replace(/^https:\/\//, "wss://");
  // Default to ws:// if no protocol
  if (!value.startsWith("ws://") && !value.startsWith("wss://")) return "ws://" + value;
  return value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/* ─── CONFIG (localStorage) ─── */

function readConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
  } catch { return {}; }
}

function writeConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config, null, 2));
}

function getConfigHash() {
  const raw = localStorage.getItem(CONFIG_KEY);
  if (!raw) return null;
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) - h) + raw.charCodeAt(i); h |= 0;
  }
  return Math.abs(h).toString(16);
}

/* ─── WEBSOCKET CONNECTION ─── */

function wsRequest(method, params = {}, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      return reject(new Error("WebSocket is not open"));
    }
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      state.pending.delete(id);
      reject(new Error(`${method} timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    state.pending.set(id, { resolve, reject, timer, method });
    state.ws.send(JSON.stringify({ type: "req", id, method, params }));
  });
}

function handleWsResponse(frame) {
  const pending = state.pending.get(frame.id);
  if (!pending) return;
  clearTimeout(pending.timer);
  state.pending.delete(frame.id);
  if (frame.ok) pending.resolve(frame.payload);
  else pending.reject(new Error(frame.error?.message || `${pending.method} failed`));
}

function disconnect() {
  clearInterval(state.pollTimer);
  state.pollTimer = null;
  for (const [, p] of state.pending) { clearTimeout(p.timer); p.reject(new Error("disconnected")); }
  state.pending.clear();
  if (state.ws) {
    try { state.ws.close(); } catch {}
    state.ws = null;
  }
  state.connected = false;
  state.connecting = false;
  state.ready = false;
  renderSummary();
}

function buildDevicePayload(token) {
  return {
    id: "web-observer",
    publicKey: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE",
    signature: "",
    signedAt: Date.now(),
    nonce: ""
  };
}

async function connect() {
  disconnect();
  state.config.gatewayUrl = normalizeGatewayUrl(els.gatewayUrl.value);
  state.config.gatewayToken = els.gatewayToken.value;
  writeConfig(state.config);
  state.connecting = true;
  renderSummary();
  logEvent("连接中", state.config.gatewayUrl);

  const url = state.config.gatewayUrl;
  const token = state.config.gatewayToken;

  try {
    const ws = new WebSocket(url);
    state.ws = ws;

    const handshake = await new Promise((resolve, reject) => {
      const failTimer = setTimeout(() => {
        reject(new Error("WebSocket connection timeout"));
        ws.close();
      }, 12000);

      ws.onopen = () => { /* wait for message */ };

      ws.onmessage = async (event) => {
        let frame;
        try { frame = JSON.parse(event.data); } catch { return; }
        if (!frame) return;

        // Handle challenge
        if (frame.type === "event" && frame.event === "connect.challenge") {
          const nonce = frame.payload?.nonce || "";
          try {
            const hello = await wsRequest("connect", {
              minProtocol: 3, maxProtocol: 3,
              client: {
                id: "openclaw-observer-web",
                displayName: "OpenClaw Observer (Web)",
                version: "0.1.0",
                platform: "web",
                mode: "ui",
                instanceId: crypto.randomUUID()
              },
              caps: [],
              auth: token ? { token } : undefined,
              role: "operator",
              scopes: ["operator.admin"],
              device: buildDevicePayload(token)
            }, 10000);
            clearTimeout(failTimer);
            resolve(hello);
          } catch (err) {
            clearTimeout(failTimer);
            reject(err);
          }
          return;
        }

        // Handle regular RPC response
        if (frame.type === "res") handleWsResponse(frame);
      };

      ws.onerror = (err) => {
        clearTimeout(failTimer);
        reject(new Error("WebSocket connection error"));
      };

      ws.onclose = () => {
        clearTimeout(failTimer);
        if (!state.connected) reject(new Error("WebSocket closed before handshake"));
        state.ready = false;
        for (const [, p] of state.pending) { clearTimeout(p.timer); p.reject(new Error("gateway disconnected")); }
        state.pending.clear();
      };
    });

    state.connected = true;
    state.connecting = false;
    state.ready = true;
    if (handshake?.snapshot?.health) state.lastHealth = handshake.snapshot.health;
    logEvent("握手成功", "协议已连接");
    renderSummary();
    await pollNow();
    refreshSlowData(true);
    startPolling();

  } catch (err) {
    state.connected = false;
    state.connecting = false;
    state.ready = false;
    renderTimeline("bad");
    renderSummary();
    logEvent("连接失败", err.message);
  }
}

/* ─── POLLING ─── */

async function pollNow() {
  if (!state.ready || state.polling) return;
  state.polling = true;
  try {
    const [health, channels, status, sessions] = await Promise.all([
      wsRequest("health", {}, 15000).catch(() => state.lastHealth),
      wsRequest("channels.status", { probe: false }, 15000).catch(() => state.lastChannels),
      wsRequest("status", {}, 15000).catch(() => state.lastStatus),
      wsRequest("sessions.list", {}, 15000).catch(() => state.lastSessions)
    ]);
    state.lastHealth = health;
    state.lastChannels = channels;
    state.lastStatus = status;
    state.lastSessions = sessions;
    updateTokenDelta();
    renderTimeline(statusClassFromSnapshot());
    renderSummary();
    refreshSlowData();
  } catch (err) {
    logEvent("轮询失败", err.message);
    renderTimeline("warn");
    renderSummary();
  } finally {
    state.polling = false;
  }
}

async function refreshSlowData(force = false) {
  if (!state.ready || state.slowPolling) return;
  if (!force && Date.now() - state.lastSlowPollAt < 30000) return;
  state.slowPolling = true;
  state.lastSlowPollAt = Date.now();
  try {
    const [models, config, usage, sessionUsage] = await Promise.all([
      wsRequest("models.list", {}, 90000).catch(() => state.lastModels),
      wsRequest("config.get", {}, 90000).catch(() => state.lastConfig),
      wsRequest("usage.status", {}, 90000).catch(() => state.lastUsage),
      wsRequest("sessions.usage", { limit: 20, mode: "specific", utcOffset: "UTC+8" }, 90000).catch(() => state.lastSessionUsage)
    ]);
    state.lastModels = models;
    state.lastConfig = config;
    state.lastUsage = usage;
    state.lastSessionUsage = sessionUsage;
    updateTokenDelta();
    renderSummary();
  } catch (err) {
    logEvent("慢速数据刷新失败", err.message);
  } finally {
    state.slowPolling = false;
  }
}

function startPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(pollNow, Math.min(state.config.pollMs || DEFAULT_CONFIG.pollMs, 2000));
}

/* ─── RENDERING (same as Electron version but adapted) ─── */

function logEvent(title, detail = "") {
  const row = document.createElement("div");
  row.className = "log-entry";
  row.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(detail)}`;
  els.eventLog.prepend(row);
  while (els.eventLog.children.length > 80) els.eventLog.lastElementChild.remove();
}

function setConnectionStatus(status, text) {
  document.body.classList.toggle("is-online", status === "online");
  document.body.classList.toggle("is-degraded", status === "degraded");
  els.statusText.textContent = text;
}

function statusClassFromSnapshot() {
  if (!state.connected || !state.ready) return "bad";
  const healthOk = state.lastHealth?.ok === true;
  const telegram = readTelegramAccount();
  if (healthOk && telegram?.running && telegram?.connected) return "ok";
  if (healthOk || telegram?.running) return "warn";
  return "bad";
}

function readTelegramAccount() {
  const accounts = state.lastChannels?.channelAccounts?.telegram;
  if (Array.isArray(accounts) && accounts.length > 0) return accounts[0];
  const channel = state.lastChannels?.channels?.telegram;
  if (channel) return channel;
  return state.lastHealth?.channels?.telegram;
}

function normalizeSessionStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["running","streaming","thinking","in_progress"].includes(value)) return { label: "会话运行中", level: "ok", active: true };
  if (["queued","pending"].includes(value)) return { label: "会话排队中", level: "warn", active: true };
  if (["failed","error","timed_out"].includes(value)) return { label: "出错", level: "bad" };
  if (["done","completed","idle"].includes(value)) return { label: "已结束", level: "idle" };
  return { label: status || "未知", level: "warn", active: false };
}

function formatAge(ms) {
  if (!ms) return "--";
  const diff = Math.max(0, Date.now() - ms);
  const minute = 60000, hour = 3600000;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  return `${Math.floor(diff / hour)} 小时前`;
}

function formatModelName(provider, model) {
  if (!provider && !model) return "--";
  if (!provider) return String(model);
  if (!model) return String(provider);
  return `${provider}/${model}`;
}

function collectUsageNumbers(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return { tokens: null, cost: null };
  seen.add(value);
  let tokens = null, cost = null;
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      const nk = key.toLowerCase();
      if (/(^|_)(totaltokens|tokens|inputtokens|outputtokens|prompttokens|completiontokens)$/.test(nk)) tokens = Math.max(tokens ?? 0, raw);
      if (/(cost|usd|amount)/.test(nk)) cost = Math.max(cost ?? 0, raw);
    } else if (raw && typeof raw === "object") {
      const n = collectUsageNumbers(raw, seen);
      if (n.tokens != null) tokens = Math.max(tokens ?? 0, n.tokens);
      if (n.cost != null) cost = Math.max(cost ?? 0, n.cost);
    }
  }
  return { tokens, cost };
}

function readFiniteNumber(v) { return typeof v === "number" && Number.isFinite(v) ? v : null; }

function latestSession() {
  const sessions = Array.isArray(state.lastSessions?.sessions) ? state.lastSessions.sessions : [];
  return sessions.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null;
}

function isRecentlyUpdated(ms, windowMs = 45000) {
  return typeof ms === "number" && Number.isFinite(ms) && Date.now() - ms >= 0 && Date.now() - ms <= windowMs;
}

function isSubagentSession(session) { return String(session?.key || "").includes(":subagent:"); }

function tokenSnapshot() {
  const session = latestSession();
  const st = readFiniteNumber(session?.totalTokens);
  if (st != null) return { tokens: st, label: st > 0 ? "当前会话" : "会话估算" };
  const ut = readFiniteNumber(state.lastSessionUsage?.totals?.totalTokens);
  if (ut != null && ut > 0) return { tokens: ut, label: "今日累计" };
  const pu = collectUsageNumbers(state.lastUsage);
  if (pu.tokens != null && pu.tokens > 0) return { tokens: pu.tokens, label: "Provider" };
  return { tokens: null, label: "无 token 数据" };
}

function updateTokenDelta() {
  const current = tokenSnapshot();
  if (current.tokens == null) { state.tokenDelta = 0; return; }
  if (state.tokenSample?.tokens != null) state.tokenDelta = Math.max(0, current.tokens - state.tokenSample.tokens);
  state.tokenSample = { ...current, at: Date.now() };
}

function formatUsage() {
  const current = tokenSnapshot();
  if (current.tokens == null) return current.label;
  const delta = state.tokenDelta > 0 ? ` / +${state.tokenDelta.toLocaleString("zh-CN")}` : "";
  return `${current.label} ${current.tokens.toLocaleString("zh-CN")}${delta}`;
}

function currentConfigModel() {
  const cfg = state.lastConfig?.parsed;
  const p = cfg?.agents?.defaults?.model?.primary;
  if (p) return p;
  const s = state.lastSessions?.defaults;
  return formatModelName(s?.modelProvider, s?.model);
}

function configBaseHash() { return state.lastConfig?.hash || state.lastConfig?.sha256 || getConfigHash(); }

function modelOptionValue(model) { return model.provider ? `${model.provider}/${model.id}` : model.id; }

function renderTimeline(level) {
  state.timeline.push({ level, at: Date.now() });
  state.timeline = state.timeline.slice(-24);
  els.timeline.innerHTML = "";
  const padded = [...Array(Math.max(0, 24 - state.timeline.length)).fill({ level: "empty" }), ...state.timeline];
  for (const item of padded) {
    const tick = document.createElement("div");
    tick.className = `tick ${item.level === "empty" ? "" : item.level}`;
    const h = item.level === "ok" ? 38 : item.level === "warn" ? 26 : item.level === "bad" ? 16 : 8;
    tick.style.height = `${h}px`;
    els.timeline.appendChild(tick);
  }
}

function renderSessionRows() {
  const sessions = Array.isArray(state.lastSessions?.sessions) ? state.lastSessions.sessions : [];
  const rows = sessions.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 8);
  if (!rows.length) {
    els.eventLog.innerHTML = `<div class="log-entry"><strong>暂无会话</strong>等待 sessions.list 数据</div>`;
    return;
  }
  els.eventLog.innerHTML = rows.map(s => {
    const st = normalizeSessionStatus(s.status);
    const age = formatAge(s.updatedAt);
    const name = s.displayName || s.key || "未命名会话";
    const model = formatModelName(s.modelProvider, s.model);
    return `<div class="session-entry ${st.level}"><div><strong>${escapeHtml(st.label)}</strong><span>${escapeHtml(age)}</span></div><p>${escapeHtml(name)}</p><em>${escapeHtml(model)}</em></div>`;
  }).join("");
}

function renderWorkStatus() {
  const tasks = state.lastStatus?.tasks;
  const sessions = Array.isArray(state.lastSessions?.sessions) ? state.lastSessions.sessions : [];
  const active = sessions.filter(s => normalizeSessionStatus(s.status).active);
  const asub = active.filter(isSubagentSession);
  const tsub = sessions.filter(isSubagentSession).length;
  const latest = latestSession();
  const running = tasks?.byStatus?.running ?? tasks?.active ?? 0;
  const queued = tasks?.byStatus?.queued ?? 0;
  const failed = tasks?.byStatus?.failed ?? 0;
  const latestAgeMs = latest?.updatedAt ? Date.now() - latest.updatedAt : Infinity;
  const fresh = state.tokenDelta > 0 || isRecentlyUpdated(latest?.updatedAt, 30000);

  els.activeTasks.textContent = `${running} 运行 / ${queued} 排队`;
  els.activeSession.textContent = latest ? `${normalizeSessionStatus(latest.status).label} · ${formatAge(latest.updatedAt)}` : "--";
  els.activeSubagents.textContent = `${asub.length} 运行 / ${tsub} 总计`;
  els.activeUsage.textContent = formatUsage();

  const safeLatestAge = Math.max(0, Math.floor(latestAgeMs / 1000));

  if (running > 0 || queued > 0) {
    if (fresh) {
      els.workState.textContent = "正在处理";
      els.workDetail.textContent = `任务队列 ${running} 运行 / ${queued} 排队，最近有会话更新或 token 增量。`;
      els.workPrimary.dataset.state = "ok";
    } else {
      els.workState.textContent = "运行无反馈";
      els.workDetail.textContent = `任务队列仍显示运行，但最近 ${safeLatestAge} 秒没有 token/会话更新。`;
      els.workPrimary.dataset.state = "warn";
    }
    return;
  }
  if (active.length > 0) {
    if (fresh) {
      els.workState.textContent = "等待回复";
      els.workDetail.textContent = "会话仍在运行，最近有更新。";
      els.workPrimary.dataset.state = "warn";
    } else {
      els.workState.textContent = "疑似卡住";
      els.workDetail.textContent = `会话标记运行，但最近 ${safeLatestAge} 秒没有更新。`;
      els.workPrimary.dataset.state = "warn";
    }
    return;
  }
  if (state.tokenDelta > 0 || isRecentlyUpdated(latest?.updatedAt)) {
    els.workState.textContent = "刚刚活动";
    els.workDetail.textContent = state.tokenDelta > 0 ? `最近轮询 token 增加 ${state.tokenDelta.toLocaleString("zh-CN")}。` : `最近会话 ${formatAge(latest.updatedAt)} 更新。`;
    els.workPrimary.dataset.state = "ok";
    return;
  }
  els.workState.textContent = "空闲";
  els.workDetail.textContent = latest ? `最近会话 ${formatAge(latest.updatedAt)} 更新。历史失败 ${failed} 个。` : "当前没有检测到运行任务。";
  els.workPrimary.dataset.state = "idle";
}

function renderSummary() {
  const healthClass = statusClassFromSnapshot();
  document.body.dataset.health = healthClass;

  const telegram = readTelegramAccount();
  const pluginCount = state.lastHealth?.plugins?.loaded?.length ?? 0;
  const pluginErrors = state.lastHealth?.plugins?.errors?.length ?? 0;
  const tasks = state.lastStatus?.tasks;
  const running = tasks?.byStatus?.running ?? tasks?.active ?? 0;
  const queued = tasks?.byStatus?.queued ?? 0;
  const succeeded = tasks?.byStatus?.succeeded ?? 0;
  const failed = tasks?.byStatus?.failed ?? 0;
  const recentSessions = state.lastHealth?.sessions?.recent?.length ?? state.lastStatus?.sessions?.recent?.length ?? 0;
  const score = healthClass === "ok" ? 98 : healthClass === "warn" ? 64 : 18;
  const agentId = state.lastHealth?.defaultAgentId ?? state.lastStatus?.agents?.defaultId ?? "--";
  const gatewayMs = state.lastHealth?.durationMs;
  const telegramText = telegram?.connected ? "已连接" : telegram?.running ? "运行中" : "未连接";
  const taskText = running || queued ? `${running} 运行 / ${queued} 排队` : "空闲";

  // Update both orbital score and small score
  els.coreScore.textContent = String(score);
  els.coreCaption.textContent = healthClass === "ok" ? "正常" : healthClass === "warn" ? "需关注" : "离线";
  if (els.coreScoreSmall) els.coreScoreSmall.textContent = String(score);
  if (els.coreCaptionSmall) els.coreCaptionSmall.textContent = healthClass === "ok" ? "正常" : healthClass === "warn" ? "需关注" : "离线";

  els.metricGateway.textContent = state.ready ? "在线" : state.connecting ? "连接中" : "离线";
  els.metricTelegram.textContent = telegramText;
  els.metricPlugins.textContent = pluginErrors ? `${pluginCount} 个 / ${pluginErrors} 错误` : `${pluginCount || "--"} 个`;
  els.metricTasks.textContent = taskText;

  els.headline.textContent = healthClass === "ok" ? "OpenClaw 正常运行" : healthClass === "warn" ? "OpenClaw 可达，但有项目需关注" : state.connecting ? "正在连接 OpenClaw" : "OpenClaw 离线或不可达";
  els.headlineDetail.textContent = healthClass === "ok" ? "网关、Telegram、插件和任务队列已连接到这块状态面板。" : healthClass === "warn" ? "核心网关可用，但下面至少一项不是完全正常。" : state.connecting ? "正在向右侧配置的 WebSocket 地址发起连接。" : "请先检查 SSH 隧道、Gateway 地址和 Token。";

  els.heroStatus.textContent = healthClass === "ok" ? "可以使用" : healthClass === "warn" ? "可以查看，但建议处理告警" : state.connecting ? "连接中" : "不可用";
  els.heroDetail.textContent = healthClass === "ok" ? `当前主 Agent 是 ${agentId}，最近会话 ${recentSessions} 个，任务队列 ${taskText}。` : healthClass === "warn" ? `网关已响应${gatewayMs != null ? ` ${gatewayMs}ms` : ""}，Telegram 状态：${telegramText}。` : "面板还没有拿到 OpenClaw 的健康数据。";

  els.overviewGateway.textContent = state.ready ? "在线" : state.connecting ? "连接中" : "离线";
  els.overviewGatewayDetail.textContent = state.lastHealth?.ok ? `健康检查 ${gatewayMs ?? "--"}ms` : state.ready ? "已握手，等待健康检查" : "WebSocket 未连接";
  els.overviewTelegram.textContent = telegramText;
  els.overviewTelegramDetail.textContent = telegram ? `${telegram.running ? "服务运行" : "服务停止"} · ${telegram.connected ? "账号已连" : "账号未连"}` : "没有频道数据";
  els.overviewAgent.textContent = agentId;
  els.overviewAgentDetail.textContent = `${recentSessions} 个最近会话`;
  els.overviewTasks.textContent = taskText;
  els.overviewTasksDetail.textContent = tasks ? `${succeeded} 成功 · ${failed} 失败` : "没有任务数据";

  els.cardGateway.dataset.state = state.ready ? "ok" : state.connecting ? "warn" : "bad";
  els.cardTelegram.dataset.state = telegram?.connected ? "ok" : telegram?.running ? "warn" : "bad";
  els.cardAgent.dataset.state = agentId !== "--" ? "ok" : "warn";
  els.cardTasks.dataset.state = failed ? "warn" : running || queued ? "ok" : "idle";

  renderModelSelect();
  renderWorkStatus();
  renderSessionRows();

  const rows = [
    ["网关", state.lastHealth?.ok ? `正常 · ${gatewayMs ?? "--"}ms` : state.ready ? "已连接" : "未连接"],
    ["Telegram", telegram ? `${telegram.running ? "运行中" : "已停止"} · ${telegram.connected ? "已连接" : "未连接"}` : "--"],
    ["主 Agent", agentId], ["最近会话", `${recentSessions} 个`],
    ["任务结果", tasks ? `${succeeded} 成功 · ${failed} 失败` : "--"]
  ];
  els.summary.innerHTML = rows.map(([l, v]) => `<div class="summary-row"><span>${escapeHtml(l)}</span><strong>${escapeHtml(v)}</strong></div>`).join("");
  els.lastSeen.textContent = state.ready ? nowTime() : "--";
  setConnectionStatus(healthClass === "ok" ? "online" : healthClass === "warn" ? "degraded" : "offline",
    healthClass === "ok" ? "在线" : healthClass === "warn" ? "告警" : "离线");
}

function renderModelSelect() {
  const models = Array.isArray(state.lastModels?.models) ? state.lastModels.models : [];
  const current = currentConfigModel();
  els.activeModel.textContent = current || "--";
  els.modelSavedAt.textContent = state.lastConfig ? nowTime() : "--";
  if (!models.length) { els.modelSelect.innerHTML = `<option value="">等待模型列表</option>`; return; }
  els.modelSelect.innerHTML = models.map(m => {
    const v = modelOptionValue(m);
    const ctx = m.contextWindow ? ` · ${Math.round(m.contextWindow / 1000)}k` : "";
    return `<option value="${escapeHtml(v)}">${escapeHtml(v)}${escapeHtml(ctx)}</option>`;
  }).join("");
  if (current) {
    const exact = [...els.modelSelect.options].find(o => o.value === current);
    const byTail = [...els.modelSelect.options].find(o => o.value.endsWith(`/${current}`) || current.endsWith(`/${o.value}`));
    if (exact || byTail) els.modelSelect.value = (exact || byTail).value;
  }
}

/* ─── MODEL SWITCH ─── */

async function applyModel() {
  const selected = els.modelSelect.value;
  if (!selected) return;
  const baseHash = configBaseHash();
  if (!baseHash) { els.modelHint.textContent = "还没有拿到配置 hash，先刷新一次。"; await pollNow(); return; }
  els.modelHint.textContent = `正在切换到 ${selected}...`;
  try {
    const patch = { agents: { defaults: { model: { primary: selected } } } };
    await wsRequest("config.patch", {
      raw: JSON.stringify(patch), baseHash,
      note: `OpenClaw Observer switched model to ${selected}`,
      restartDelayMs: 800
    }, 15000);
    els.modelHint.textContent = `已提交切换：${selected}。如果网关重启，面板会自动重连。`;
    await pollNow();
  } catch (err) {
    els.modelHint.textContent = `切换失败：${err.message}`;
    logEvent("切换模型失败", err.message);
  }
}

/* ─── INIT ─── */

async function init() {
  const saved = readConfig();
  state.config = { ...DEFAULT_CONFIG, ...saved };
  els.gatewayUrl.value = state.config.gatewayUrl;
  els.gatewayToken.value = state.config.gatewayToken;
  renderTimeline("empty");
  renderSummary();

  els.connectBtn.addEventListener("click", async () => {
    writeConfig({ ...state.config, gatewayUrl: normalizeGatewayUrl(els.gatewayUrl.value), gatewayToken: els.gatewayToken.value });
    connect();
  });
  els.disconnectBtn.addEventListener("click", disconnect);
  els.saveBtn.addEventListener("click", async () => {
    writeConfig({ ...state.config, gatewayUrl: normalizeGatewayUrl(els.gatewayUrl.value), gatewayToken: els.gatewayToken.value });
    connect();
  });
  els.clearLogBtn.addEventListener("click", () => { els.eventLog.innerHTML = ""; });
  els.refreshBtn.addEventListener("click", pollNow);
  els.applyModelBtn.addEventListener("click", applyModel);

  // Auto-connect on page load
  connect();
}

init().catch(err => { logEvent("启动失败", err.message); });
