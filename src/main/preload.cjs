const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("observerApi", {
  readConfig: () => ipcRenderer.invoke("config:read"),
  writeConfig: (config) => ipcRenderer.invoke("config:write", config),
  openExternal: (url) => ipcRenderer.invoke("open:external", url),
  readSystemStats: () => ipcRenderer.invoke("system:stats"),
  gatewayConnect: (config) => ipcRenderer.invoke("gateway:connect", config),
  gatewayRequest: (method, params, timeoutMs) => ipcRenderer.invoke("gateway:request", method, params, timeoutMs),
  gatewayDisconnect: () => ipcRenderer.invoke("gateway:disconnect")
});
