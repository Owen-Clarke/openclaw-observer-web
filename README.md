# OpenClaw Observer

Windows desktop observer for a remote OpenClaw Gateway. It renders the gateway, Telegram channel, plugins, tasks, and sessions as a live 3D dashboard.

## Run

```bash
npm install
npm run dev
```

On Windows, run the same commands in this folder. To build an installer:

```bash
npm run pack:win
```

When building on Linux without Wine, create an unpacked Windows app instead:

```bash
npm run pack:win:dir
```

The full NSIS installer target requires Wine on Linux, or you can run `npm run pack:win` directly on the Windows machine.

## Connecting to your Linux OpenClaw

The safest path is an SSH tunnel from the Windows computer:

```powershell
ssh -N -L 18789:127.0.0.1:18789 your-user@your-linux-host
```

Then use:

```text
ws://127.0.0.1:18789
```

Use the Gateway token configured on the Linux OpenClaw host. Do not expose port `18789` to the public internet.

## Data sources

The app connects to the OpenClaw Gateway WebSocket RPC and polls:

- `health`
- `channels.status`
- `status`

It does not read chat payloads or secrets.
