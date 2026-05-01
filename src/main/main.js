import { app, BrowserWindow, ipcMain, shell, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import { WebSocket } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = "observer-config.json";
const DEVICE_IDENTITY_FILE = "observer-device-identity.json";
const CONTROL_UI_ORIGIN = "http://127.0.0.1:1420";
const CLIENT_ID = "openclaw-control-ui";
const CLIENT_MODE = "ui";
const ROLE = "operator";
const SCOPES = ["operator.admin"];
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const APP_VERSION = "0.1.2";

class GatewayRpc {
  ws = null;
  ready = false;
  pending = new Map();
  hello = null;

  async connect(config) {
    this.disconnect();
    const savedConfig = await readConfig();
    const effectiveConfig = {
      ...savedConfig,
      ...(config && typeof config === "object" ? config : {})
    };
    if (!String(effectiveConfig.gatewayToken || "").trim() && String(savedConfig.gatewayToken || "").trim()) {
      effectiveConfig.gatewayToken = savedConfig.gatewayToken;
    }
    if (!String(effectiveConfig.gatewayUrl || "").trim() && String(savedConfig.gatewayUrl || "").trim()) {
      effectiveConfig.gatewayUrl = savedConfig.gatewayUrl;
    }
    const url = normalizeGatewayUrl(effectiveConfig.gatewayUrl);
    const token = typeof effectiveConfig.gatewayToken === "string" ? effectiveConfig.gatewayToken.trim() : "";

    return await new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers: { Origin: CONTROL_UI_ORIGIN } });
      this.ws = ws;
      const failTimer = setTimeout(() => {
        reject(new Error("gateway connect timeout"));
        this.disconnect();
      }, 12000);

      ws.on("message", async (data) => {
        const frame = safeJson(data.toString());
        if (!frame) return;

        if (frame.type === "event" && frame.event === "connect.challenge") {
          try {
            const nonce = typeof frame.payload?.nonce === "string" ? frame.payload.nonce : "";
            const device = await buildSignedDeviceIdentity({
              nonce,
              token,
              role: ROLE,
              scopes: SCOPES,
              clientId: CLIENT_ID,
              clientMode: CLIENT_MODE
            });
            const hello = await this.request("connect", {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: CLIENT_ID,
                displayName: "OpenClaw Observer",
                version: APP_VERSION,
                platform: process.platform,
                mode: CLIENT_MODE,
                instanceId: crypto.randomUUID()
              },
              caps: [],
              auth: token ? { token } : undefined,
              role: ROLE,
              scopes: SCOPES,
              device
            }, 10000);
            clearTimeout(failTimer);
            this.ready = true;
            this.hello = hello;
            resolve(hello);
          } catch (err) {
            clearTimeout(failTimer);
            reject(err);
            this.disconnect();
          }
          return;
        }

        if (frame.type === "res") this.handleResponse(frame);
      });

      ws.on("error", (err) => {
        clearTimeout(failTimer);
        reject(err);
      });

      ws.on("close", () => {
        this.ready = false;
        for (const [, pending] of this.pending) {
          clearTimeout(pending.timeout);
          pending.reject(new Error("gateway disconnected"));
        }
        this.pending.clear();
      });
    });
  }

  handleResponse(frame) {
    const pending = this.pending.get(frame.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(frame.id);
    if (frame.ok) pending.resolve(frame.payload);
    else pending.reject(new Error(frame.error?.message || `${pending.method} failed`));
  }

  request(method, params = {}, timeoutMs = 9000) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("gateway websocket is not open");
    }
    const id = crypto.randomUUID();
    this.ws.send(JSON.stringify({ type: "req", id, method, params }));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timeout`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout, method });
    });
  }

  disconnect() {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("gateway disconnected"));
    }
    this.pending.clear();
    this.ready = false;
    this.hello = null;
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }
}

const gatewayRpc = new GatewayRpc();

function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeGatewayUrl(raw) {
  const value = String(raw || "").trim() || "ws://127.0.0.1:18789";
  if (value.startsWith("http://")) return value.replace(/^http:\/\//, "ws://");
  if (value.startsWith("https://")) return value.replace(/^https:\/\//, "wss://");
  return value;
}

function getConfigPath() {
  return path.join(app.getPath("userData"), CONFIG_FILE);
}

async function readConfig() {
  try {
    const raw = await fs.readFile(getConfigPath(), "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    return {};
  }
}

async function writeConfig(config) {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function base64UrlEncode(buf) {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function normalizeDeviceMetadata(value) {
  return typeof value === "string" ? value.trim().replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32)) : "";
}

function derivePublicKeyRaw(publicKeyPem) {
  const spki = crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  if (spki.length === ED25519_SPKI_PREFIX.length + 32 && spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function publicKeyRawBase64UrlFromPem(publicKeyPem) {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function fingerprintPublicKey(publicKeyPem) {
  return crypto.createHash("sha256").update(derivePublicKeyRaw(publicKeyPem)).digest("hex");
}

function generateDeviceIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  return {
    version: 1,
    deviceId: fingerprintPublicKey(publicKeyPem),
    publicKeyPem,
    privateKeyPem,
    createdAtMs: Date.now()
  };
}

async function loadOrCreateDeviceIdentity() {
  const filePath = path.join(app.getPath("userData"), DEVICE_IDENTITY_FILE);
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (parsed?.version === 1 && parsed.deviceId && parsed.publicKeyPem && parsed.privateKeyPem) return parsed;
  } catch {}

  const identity = generateDeviceIdentity();
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(identity, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return identity;
}

function buildDeviceAuthPayload({ deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce, platform, deviceFamily }) {
  return [
    "v3",
    deviceId,
    clientId,
    clientMode,
    role,
    scopes.join(","),
    String(signedAtMs),
    token || "",
    nonce,
    normalizeDeviceMetadata(platform),
    normalizeDeviceMetadata(deviceFamily)
  ].join("|");
}

async function buildSignedDeviceIdentity({ nonce, token, role, scopes, clientId, clientMode }) {
  if (!nonce) throw new Error("gateway connect challenge missing nonce");
  const identity = await loadOrCreateDeviceIdentity();
  const signedAtMs = Date.now();
  const payload = buildDeviceAuthPayload({
    deviceId: identity.deviceId,
    clientId,
    clientMode,
    role,
    scopes,
    signedAtMs,
    token,
    nonce,
    platform: process.platform
  });
  const signature = base64UrlEncode(crypto.sign(null, Buffer.from(payload, "utf8"), crypto.createPrivateKey(identity.privateKeyPem)));
  return {
    id: identity.deviceId,
    publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
    signature,
    signedAt: signedAtMs,
    nonce
  };
}

function createWindow() {
  const bounds = calculateWindowBounds();
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: bounds.minWidth,
    minHeight: bounds.minHeight,
    backgroundColor: "#080b10",
    title: "OpenClaw Observer",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, "../renderer/index.html"));
  win.once("ready-to-show", () => {
    win.setBounds(bounds, false);
    win.maximize();
    win.show();
    console.log(`[observer] window bounds=${JSON.stringify(win.getBounds())} workArea=${JSON.stringify(screen.getPrimaryDisplay().workArea)}`);
  });
}

function calculateWindowBounds() {
  const display = screen.getPrimaryDisplay();
  const workArea = display?.workArea || { x: 0, y: 0, width: 1280, height: 720 };
  const margin = workArea.width <= 1200 || workArea.height <= 820 ? 0 : 8;
  const width = Math.max(1, workArea.width - margin * 2);
  const height = Math.max(1, workArea.height - margin * 2);
  return {
    x: workArea.x + margin,
    y: workArea.y + margin,
    width,
    height,
    minWidth: Math.min(640, width),
    minHeight: Math.min(420, height)
  };
}

function readSystemStats() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    appVersion: APP_VERSION,
    memoryPercent: totalMem > 0 ? Math.max(0, Math.min(100, (1 - freeMem / totalMem) * 100)) : null,
    totalMemoryBytes: totalMem,
    freeMemoryBytes: freeMem,
    sampledAt: Date.now()
  };
}

app.whenReady().then(() => {
  ipcMain.handle("config:read", readConfig);
  ipcMain.handle("config:write", async (_event, config) => {
    await writeConfig(config && typeof config === "object" ? config : {});
    return true;
  });
  ipcMain.handle("open:external", async (_event, url) => {
    if (typeof url === "string" && /^https?:\/\//.test(url)) {
      await shell.openExternal(url);
    }
  });
  ipcMain.handle("gateway:connect", async (_event, config) => gatewayRpc.connect(config));
  ipcMain.handle("gateway:request", async (_event, method, params, timeoutMs) => gatewayRpc.request(method, params, timeoutMs));
  ipcMain.handle("gateway:disconnect", async () => {
    gatewayRpc.disconnect();
    return true;
  });
  ipcMain.handle("system:stats", async () => readSystemStats());

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
