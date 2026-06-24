# Voice Garden desktop shell

This is the first Electron wrapper around the existing all-in-one local app.

It deliberately keeps the working browser/server version intact:

- `npm run app` still starts the local Vite + analyze server in the browser.
- `npm run electron:dev` starts that same local server, waits for it, then opens it inside an Electron desktop window.

That means this branch is a desktop shell first, not a packaged installer yet. The analyzer still expects the existing local development setup: `uv`, Python deps, and the repo files.

## Run it

From `dashboard-react`:

```powershell
npm install
npm run electron:dev
```

This starts both pieces:

1. `node server.mjs`, which serves the React app and exposes `POST /api/analyze`.
2. Electron, which opens `http://127.0.0.1:5173` in a desktop window.

## Fallback

If Electron explodes because desktop app tooling enjoys melodrama:

```powershell
npm run app
```

Then open:

```text
http://localhost:5173
```

The browser version should keep working exactly like the known-good recorder MVP.

## Next steps

Likely next branches/commits:

- move script storage from `localStorage` to an app data JSON file
- move analyzer execution from `server.mjs` into Electron IPC
- add packaged Windows build with bundled app assets
- later bundle or document `uv`, Python, and ffmpeg requirements more cleanly
