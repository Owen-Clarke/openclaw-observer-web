const DEFAULT_CONFIG = {
  gatewayUrl: "ws://127.0.0.1:18789",
  gatewayToken: "",
  pollMs: 5000
};

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
  lastSystemStats: null,
  tokenSample: null,
  tokenDelta: 0,
  slowPolling: false,
  lastSlowPollAt: 0,
  systemTimer: null,
  instanceId: crypto.randomUUID()
};

const $ = (id) => document.getElementById(id);

const els = {
  gatewayUrl: $("gatewayUrl"),
  gatewayToken: $("gatewayToken"),
  connectBtn: $("connectBtn"),
  disconnectBtn: $("disconnectBtn"),
  saveBtn: $("saveBtn"),
  clearLogBtn: $("clearLogBtn"),
  refreshBtn: $("refreshBtn"),
  applyModelBtn: $("applyModelBtn"),
  modelSelect: $("modelSelect"),
  modelSavedAt: $("modelSavedAt"),
  modelHint: $("modelHint"),
  statusPill: $("statusPill"),
  statusText: $("statusText"),
  headline: $("headline"),
  headlineDetail: $("headlineDetail"),
  heroStatus: $("heroStatus"),
  heroDetail: $("heroDetail"),
  coreScore: $("coreScore"),
  coreCaption: $("coreCaption"),
  overviewGateway: $("overviewGateway"),
  overviewGatewayDetail: $("overviewGatewayDetail"),
  overviewTelegram: $("overviewTelegram"),
  overviewTelegramDetail: $("overviewTelegramDetail"),
  overviewAgent: $("overviewAgent"),
  overviewAgentDetail: $("overviewAgentDetail"),
  overviewTasks: $("overviewTasks"),
  overviewTasksDetail: $("overviewTasksDetail"),
  workState: $("workState"),
  workDetail: $("workDetail"),
  workPrimary: $("workPrimary"),
  activeModel: $("activeModel"),
  activeSession: $("activeSession"),
  activeTasks: $("activeTasks"),
  activeSubagents: $("activeSubagents"),
  activeUsage: $("activeUsage"),
  cardGateway: $("cardGateway"),
  cardTelegram: $("cardTelegram"),
  cardAgent: $("cardAgent"),
  cardTasks: $("cardTasks"),
  metricGateway: $("metricGateway"),
  metricTelegram: $("metricTelegram"),
  metricPlugins: $("metricPlugins"),
  metricTasks: $("metricTasks"),
  metricMemory: $("metricMemory"),
  metricMemoryCard: $("metricMemoryCard"),
  summary: $("summary"),
  eventLog: $("eventLog"),
  timeline: $("timeline"),
  lastSeen: $("lastSeen")
};

function nowTime() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function normalizeGatewayUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return DEFAULT_CONFIG.gatewayUrl;
  if (value.startsWith("http://")) return value.replace(/^http:\/\//, "ws://");
  if (value.startsWith("https://")) return value.replace(/^https:\/\//, "wss://");
  return value;
}

function logEvent(title, detail = "") {
  const row = document.createElement("div");
  row.className = "log-entry";
  row.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(detail)}`;
  els.eventLog.prepend(row);
  while (els.eventLog.children.length > 80) els.eventLog.lastElementChild.remove();
}

function renderSessionRows() {
  const sessions = Array.isArray(state.lastSessions?.sessions) ? state.lastSessions.sessions : [];
  const rows = sessions
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 8);
  if (!rows.length) {
    els.eventLog.innerHTML = `<div class="log-entry"><strong>暂无会话</strong>等待 sessions.list 数据</div>`;
    return;
  }
  els.eventLog.innerHTML = rows.map((session) => {
    const status = normalizeSessionStatus(session.status);
    const age = formatAge(session.updatedAt);
    const name = session.displayName || session.key || "未命名会话";
    const model = formatModelName(session.modelProvider, session.model);
    return `<div class="session-entry ${status.level}">
      <div><strong>${escapeHtml(status.label)}</strong><span>${escapeHtml(age)}</span></div>
      <p>${escapeHtml(name)}</p>
      <em>${escapeHtml(model)}</em>
    </div>`;
  }).join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

function renderTimeline(level) {
  state.timeline.push({ level, at: Date.now() });
  state.timeline = state.timeline.slice(-24);
  els.timeline.innerHTML = "";
  const padded = [...Array(Math.max(0, 24 - state.timeline.length)).fill({ level: "empty" }), ...state.timeline];
  for (const item of padded) {
    const tick = document.createElement("div");
    tick.className = `tick ${item.level === "empty" ? "" : item.level}`;
    const height = item.level === "ok" ? 38 : item.level === "warn" ? 26 : item.level === "bad" ? 16 : 8;
    tick.style.height = `${height}px`;
    els.timeline.appendChild(tick);
  }
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
  if (["running", "streaming", "thinking", "in_progress"].includes(value)) return { label: "会话运行中", level: "ok", active: true };
  if (["queued", "pending"].includes(value)) return { label: "会话排队中", level: "warn", active: true };
  if (["failed", "error", "timed_out"].includes(value)) return { label: "出错", level: "bad" };
  if (["done", "completed", "idle"].includes(value)) return { label: "已结束", level: "idle" };
  return { label: status || "未知", level: "warn", active: false };
}

function formatAge(ms) {
  if (!ms) return "--";
  const diff = Math.max(0, Date.now() - ms);
  const minute = 60 * 1000;
  const hour = 60 * minute;
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
  let tokens = null;
  let cost = null;
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      const normalized = key.toLowerCase();
      if (/(^|_)(totaltokens|tokens|inputtokens|outputtokens|prompttokens|completiontokens)$/.test(normalized)) {
        tokens = Math.max(tokens ?? 0, raw);
      }
      if (/(cost|usd|amount)/.test(normalized)) {
        cost = Math.max(cost ?? 0, raw);
      }
    } else if (raw && typeof raw === "object") {
      const nested = collectUsageNumbers(raw, seen);
      if (nested.tokens != null) tokens = Math.max(tokens ?? 0, nested.tokens);
      if (nested.cost != null) cost = Math.max(cost ?? 0, nested.cost);
    }
  }
  return { tokens, cost };
}

function readFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function latestSession() {
  const sessions = Array.isArray(state.lastSessions?.sessions) ? state.lastSessions.sessions : [];
  return sessions.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null;
}

function isRecentlyUpdated(ms, windowMs = 45000) {
  return typeof ms === "number" && Number.isFinite(ms) && Date.now() - ms >= 0 && Date.now() - ms <= windowMs;
}

function isSubagentSession(session) {
  return String(session?.key || "").includes(":subagent:");
}

function tokenSnapshot() {
  const session = latestSession();
  const sessionTokens = readFiniteNumber(session?.totalTokens);
  if (sessionTokens != null) {
    return {
      tokens: sessionTokens,
      label: session?.totalTokensFresh === false ? "会话估算" : "当前会话"
    };
  }

  const usageTokens = readFiniteNumber(state.lastSessionUsage?.totals?.totalTokens);
  if (usageTokens != null && usageTokens > 0) {
    return { tokens: usageTokens, label: "今日累计" };
  }

  const providerUsage = collectUsageNumbers(state.lastUsage);
  if (providerUsage.tokens != null && providerUsage.tokens > 0) {
    return { tokens: providerUsage.tokens, label: "Provider" };
  }

  return { tokens: null, label: "无 token 数据" };
}

function updateTokenDelta() {
  const current = tokenSnapshot();
  if (current.tokens == null) {
    state.tokenDelta = 0;
    return;
  }
  if (state.tokenSample?.tokens != null) {
    state.tokenDelta = Math.max(0, current.tokens - state.tokenSample.tokens);
  }
  state.tokenSample = { ...current, at: Date.now() };
}

function formatUsage() {
  const current = tokenSnapshot();
  if (current.tokens == null) return current.label;
  const delta = state.tokenDelta > 0 ? ` / +${state.tokenDelta.toLocaleString("zh-CN")}` : "";
  return `${current.label} ${current.tokens.toLocaleString("zh-CN")}${delta}`;
}

function formatPercent(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : "--";
}

function memoryLoadLevel(memoryPercent) {
  if (typeof memoryPercent !== "number" || !Number.isFinite(memoryPercent)) return "idle";
  if (memoryPercent >= 90) return "bad";
  if (memoryPercent >= 75) return "warn";
  return "ok";
}

function currentConfigModel() {
  const cfg = state.lastConfig?.parsed;
  return cfg?.agents?.defaults?.model?.primary || formatModelName(state.lastSessions?.defaults?.modelProvider, state.lastSessions?.defaults?.model);
}

function configBaseHash() {
  return state.lastConfig?.hash || state.lastConfig?.sha256 || state.lastConfig?.baseHash || null;
}

function modelOptionValue(model) {
  if (!model) return "";
  return model.provider ? `${model.provider}/${model.id}` : model.id;
}

function renderModelSelect() {
  const models = Array.isArray(state.lastModels?.models) ? state.lastModels.models : [];
  const current = currentConfigModel();
  els.activeModel.textContent = current || "--";
  els.modelSavedAt.textContent = state.lastConfig ? nowTime() : "--";

  if (!models.length) {
    els.modelSelect.innerHTML = `<option value="">等待模型列表</option>`;
    return;
  }

  const options = models.map((model) => {
    const value = modelOptionValue(model);
    const context = model.contextWindow ? ` · ${Math.round(model.contextWindow / 1000)}k` : "";
    const label = `${value}${context}`;
    return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
  }).join("");
  els.modelSelect.innerHTML = options;
  if (current) {
    const exact = [...els.modelSelect.options].find((option) => option.value === current);
    const byTail = [...els.modelSelect.options].find((option) => option.value.endsWith(`/${current}`) || current.endsWith(`/${option.value}`));
    if (exact || byTail) els.modelSelect.value = (exact || byTail).value;
  }
}

function renderWorkStatus() {
  const tasks = state.lastStatus?.tasks;
  const sessions = Array.isArray(state.lastSessions?.sessions) ? state.lastSessions.sessions : [];
  const activeSessions = sessions.filter((session) => normalizeSessionStatus(session.status).active);
  const activeSubagents = activeSessions.filter(isSubagentSession);
  const subagentTotal = sessions.filter(isSubagentSession).length;
  const latest = latestSession();
  const runningTasks = tasks?.byStatus?.running ?? tasks?.active ?? 0;
  const queuedTasks = tasks?.byStatus?.queued ?? 0;
  const failedTasks = tasks?.byStatus?.failed ?? 0;
  const latestAgeMs = latest?.updatedAt ? Date.now() - latest.updatedAt : Infinity;
  const hasFreshFeedback = state.tokenDelta > 0 || isRecentlyUpdated(latest?.updatedAt, 30000);

  els.activeTasks.textContent = `${runningTasks} 运行 / ${queuedTasks} 排队`;
  els.activeSession.textContent = latest ? `${normalizeSessionStatus(latest.status).label} · ${formatAge(latest.updatedAt)}` : "--";
  els.activeSubagents.textContent = `${activeSubagents.length} 运行 / ${subagentTotal} 总计`;
  els.activeUsage.textContent = formatUsage();

  if (runningTasks > 0 || queuedTasks > 0) {
    if (hasFreshFeedback) {
      els.workState.textContent = "正在处理";
      els.workDetail.textContent = `任务队列 ${runningTasks} 运行 / ${queuedTasks} 排队，最近有会话更新或 token 增量。`;
      els.workPrimary.dataset.state = "ok";
      return;
    }
    els.workState.textContent = "运行无反馈";
    els.workDetail.textContent = `任务队列仍显示运行，但最近 ${Math.max(0, Math.floor(latestAgeMs / 1000))} 秒没有 token/会话更新；Telegram 输入状态未提供。`;
    els.workPrimary.dataset.state = "warn";
    return;
  }
  if (activeSessions.length > 0) {
    if (hasFreshFeedback) {
      els.workState.textContent = "等待回复";
      els.workDetail.textContent = `会话仍在运行，最近有更新；Telegram 未提供输入中信号。`;
      els.workPrimary.dataset.state = "warn";
      return;
    }
    els.workState.textContent = "疑似卡住";
    els.workDetail.textContent = `会话标记运行，但最近 ${Math.max(0, Math.floor(latestAgeMs / 1000))} 秒没有 token 增量、会话更新或 Telegram 回显。`;
    els.workPrimary.dataset.state = "warn";
    return;
  }
  if (state.tokenDelta > 0 || isRecentlyUpdated(latest?.updatedAt)) {
    els.workState.textContent = "刚刚活动";
    els.workDetail.textContent = state.tokenDelta > 0
      ? `最近一次轮询 token 增加 ${state.tokenDelta.toLocaleString("zh-CN")}。`
      : `最近会话 ${formatAge(latest.updatedAt)} 更新，当前没有运行队列。`;
    els.workPrimary.dataset.state = "ok";
    return;
  }
  els.workState.textContent = "空闲";
  els.workDetail.textContent = latest
    ? `最近会话 ${formatAge(latest.updatedAt)} 更新。历史失败 ${failedTasks} 个不代表当前在跑。`
    : "当前没有检测到正在运行的任务。";
  els.workPrimary.dataset.state = "idle";
}

function renderSummary() {
  const healthClass = statusClassFromSnapshot();
  document.body.dataset.health = healthClass;

  const telegram = readTelegramAccount();
  const pluginCount = state.lastHealth?.plugins?.loaded?.length ?? 0;
  const pluginErrors = state.lastHealth?.plugins?.errors?.length ?? 0;
  const tasks = state.lastStatus?.tasks;
  const runningTasks = tasks?.byStatus?.running ?? tasks?.active ?? 0;
  const queuedTasks = tasks?.byStatus?.queued ?? 0;
  const succeededTasks = tasks?.byStatus?.succeeded ?? 0;
  const failedTasks = tasks?.byStatus?.failed ?? 0;
  const recentSessions = state.lastHealth?.sessions?.recent?.length ?? state.lastStatus?.sessions?.recent?.length ?? 0;
  const score = healthClass === "ok" ? 98 : healthClass === "warn" ? 64 : 18;
  const agentId = state.lastHealth?.defaultAgentId ?? state.lastStatus?.agents?.defaultId ?? "--";
  const gatewayMs = state.lastHealth?.durationMs;
  const telegramText = telegram?.connected ? "已连接" : telegram?.running ? "运行中" : "未连接";
  const taskText = runningTasks || queuedTasks ? `${runningTasks} 运行 / ${queuedTasks} 排队` : "空闲";
  const memoryPercent = state.lastSystemStats?.memoryPercent;
  const memoryText = formatPercent(memoryPercent);
  const memoryLevel = memoryLoadLevel(memoryPercent);

  els.coreScore.textContent = String(score);
  els.coreCaption.textContent = healthClass === "ok" ? "正常" : healthClass === "warn" ? "需关注" : "离线";
  els.metricGateway.textContent = state.ready ? "在线" : state.connecting ? "连接中" : "离线";
  els.metricTelegram.textContent = telegramText;
  els.metricPlugins.textContent = pluginErrors ? `${pluginCount} 个 / ${pluginErrors} 错误` : `${pluginCount || "--"} 个`;
  els.metricTasks.textContent = taskText;
  els.metricMemory.textContent = memoryText;
  els.metricMemoryCard.dataset.state = memoryLevel;

  els.headline.textContent =
    healthClass === "ok" ? "OpenClaw 正常运行" :
    healthClass === "warn" ? "OpenClaw 可达，但有项目需关注" :
    state.connecting ? "正在连接 OpenClaw" :
    "OpenClaw 离线或不可达";
  els.headlineDetail.textContent =
    healthClass === "ok" ? "网关、Telegram、插件和任务队列已连接到这块状态面板。" :
    healthClass === "warn" ? "核心网关可用，但下面至少一项不是完全正常。" :
    state.connecting ? "正在向右侧配置的 WebSocket 地址发起连接。" :
    "请先检查 SSH 隧道、Gateway 地址和 Token。";

  els.heroStatus.textContent =
    healthClass === "ok" ? "可以使用" :
    healthClass === "warn" ? "可以查看，但建议处理告警" :
    state.connecting ? "连接中" :
    "不可用";
  els.heroDetail.textContent =
    healthClass === "ok" ? `当前主 Agent 是 ${agentId}，最近会话 ${recentSessions} 个，任务队列${taskText}。` :
    healthClass === "warn" ? `网关已响应${gatewayMs != null ? ` ${gatewayMs}ms` : ""}，Telegram 状态：${telegramText}。` :
    "面板还没有拿到 OpenClaw 的健康数据。";

  els.overviewGateway.textContent = state.ready ? "在线" : state.connecting ? "连接中" : "离线";
  els.overviewGatewayDetail.textContent = state.lastHealth?.ok ? `健康检查 ${gatewayMs ?? "--"}ms` : state.ready ? "已握手，等待健康检查" : "WebSocket 未连接";
  els.overviewTelegram.textContent = telegramText;
  els.overviewTelegramDetail.textContent = telegram ? `${telegram.running ? "服务运行" : "服务停止"} · ${telegram.connected ? "账号已连" : "账号未连"}` : "没有频道数据";
  els.overviewAgent.textContent = agentId;
  els.overviewAgentDetail.textContent = `${recentSessions} 个最近会话`;
  els.overviewTasks.textContent = taskText;
  els.overviewTasksDetail.textContent = tasks ? `${succeededTasks} 成功 · ${failedTasks} 失败` : "没有任务数据";

  els.cardGateway.dataset.state = state.ready ? "ok" : state.connecting ? "warn" : "bad";
  els.cardTelegram.dataset.state = telegram?.connected ? "ok" : telegram?.running ? "warn" : "bad";
  els.cardAgent.dataset.state = agentId !== "--" ? "ok" : "warn";
  els.cardTasks.dataset.state = failedTasks ? "warn" : runningTasks || queuedTasks ? "ok" : "idle";
  renderModelSelect();
  renderWorkStatus();
  renderSessionRows();

  const rows = [
    ["网关", state.lastHealth?.ok ? `正常 · ${gatewayMs ?? "--"}ms` : state.ready ? "已连接" : "未连接"],
    ["Telegram", telegram ? `${telegram.running ? "运行中" : "已停止"} · ${telegram.connected ? "已连接" : "未连接"}` : "--"],
    ["主 Agent", agentId],
    ["最近会话", `${recentSessions} 个`],
    ["任务结果", tasks ? `${succeededTasks} 成功 · ${failedTasks} 失败` : "--"]
  ];

  els.summary.innerHTML = rows
    .map(([label, value]) => `<div class="summary-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");

  els.lastSeen.textContent = state.ready ? nowTime() : "--";
  setConnectionStatus(
    healthClass === "ok" ? "online" : healthClass === "warn" ? "degraded" : "offline",
    healthClass === "ok" ? "在线" : healthClass === "warn" ? "告警" : "离线"
  );
}

function request(method, params = {}, timeoutMs = 9000) {
  return Promise.race([
    window.observerApi.gatewayRequest(method, params, timeoutMs),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${method} timeout`)), timeoutMs))
  ]);
}

async function pollNow() {
  if (!state.ready || state.polling) return;
  state.polling = true;
  try {
    const [health, channels, status, sessions] = await Promise.all([
      request("health", {}, 15000).catch(() => state.lastHealth),
      request("channels.status", { probe: false }, 15000).catch(() => state.lastChannels),
      request("status", {}, 15000).catch(() => state.lastStatus),
      request("sessions.list", {}, 15000).catch(() => state.lastSessions)
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

async function refreshSystemStats() {
  try {
    state.lastSystemStats = await window.observerApi.readSystemStats();
    renderSummary();
  } catch (err) {
    logEvent("本机状态读取失败", err.message);
  }
}

async function refreshSlowData(force = false) {
  if (!state.ready || state.slowPolling) return;
  if (!force && Date.now() - state.lastSlowPollAt < 30000) return;
  state.slowPolling = true;
  state.lastSlowPollAt = Date.now();
  try {
    const [models, config, usage, sessionUsage] = await Promise.all([
      request("models.list", {}, 90000).catch(() => state.lastModels),
      request("config.get", {}, 90000).catch(() => state.lastConfig),
      request("usage.status", {}, 90000).catch(() => state.lastUsage),
      request("sessions.usage", { limit: 20, mode: "specific", utcOffset: "UTC+8" }, 90000).catch(() => state.lastSessionUsage)
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

function startSystemPolling() {
  clearInterval(state.systemTimer);
  refreshSystemStats();
  state.systemTimer = setInterval(refreshSystemStats, 2000);
}

function disconnect() {
  clearInterval(state.pollTimer);
  state.pollTimer = null;
  for (const [, pending] of state.pending) {
    clearTimeout(pending.timeout);
    pending.reject(new Error("disconnected"));
  }
  state.pending.clear();
  if (state.ws) {
    state.ws = null;
  }
  window.observerApi.gatewayDisconnect().catch(() => {});
  state.connected = false;
  state.connecting = false;
  state.ready = false;
  renderSummary();
}

async function connect() {
  disconnect();
  state.config.gatewayUrl = normalizeGatewayUrl(els.gatewayUrl.value);
  state.config.gatewayToken = els.gatewayToken.value;
  state.connecting = true;
  renderSummary();
  logEvent("连接中", state.config.gatewayUrl);

  try {
    const hello = await window.observerApi.gatewayConnect(state.config);
    state.connected = true;
    state.connecting = false;
    state.ready = true;
    if (hello?.snapshot?.health) state.lastHealth = hello.snapshot.health;
    logEvent("握手成功", `协议已连接，methods=${hello?.features?.methods?.length ?? "--"}`);
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

async function saveConfig() {
  state.config.gatewayUrl = normalizeGatewayUrl(els.gatewayUrl.value);
  state.config.gatewayToken = els.gatewayToken.value;
  await window.observerApi.writeConfig(state.config);
  logEvent("配置已保存", state.config.gatewayUrl);
}

async function applyModel() {
  const selected = els.modelSelect.value;
  if (!selected) return;
  const baseHash = configBaseHash();
  if (!baseHash) {
    els.modelHint.textContent = "还没有拿到配置 hash，先刷新一次。";
    await pollNow();
    return;
  }
  els.modelHint.textContent = `正在切换到 ${selected}...`;
  try {
    const patch = {
      agents: {
        defaults: {
          model: {
            primary: selected
          }
        }
      }
    };
    const result = await request("config.patch", {
      raw: JSON.stringify(patch),
      baseHash,
      note: `OpenClaw Observer switched model to ${selected}`,
      restartDelayMs: 800
    }, 15000);
    state.lastConfig = { ...state.lastConfig, parsed: result?.config || state.lastConfig?.parsed };
    els.modelHint.textContent = `已提交切换：${selected}。如果网关重启，面板会自动重连。`;
    await pollNow();
  } catch (err) {
    els.modelHint.textContent = `切换失败：${err.message}`;
    logEvent("切换模型失败", err.message);
  }
}

async function init() {
  const saved = await window.observerApi.readConfig();
  state.config = { ...DEFAULT_CONFIG, ...saved };
  els.gatewayUrl.value = state.config.gatewayUrl;
  els.gatewayToken.value = state.config.gatewayToken;
  renderTimeline("empty");
  renderSummary();
  startSystemPolling();

  els.connectBtn.addEventListener("click", async () => {
    await saveConfig();
    connect();
  });
  els.disconnectBtn.addEventListener("click", disconnect);
  els.saveBtn.addEventListener("click", async () => {
    await saveConfig();
    connect();
  });
  els.clearLogBtn.addEventListener("click", () => {
    els.eventLog.innerHTML = "";
  });
  els.refreshBtn.addEventListener("click", pollNow);
  els.applyModelBtn.addEventListener("click", applyModel);

  connect();
}

init().catch((err) => {
  logEvent("启动失败", err.message);
});
