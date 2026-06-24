# Voice Garden desktop shell and Windows installer

This branch builds on the working all-in-one recorder MVP.

The safe fallback remains intact:

- `npm run app` starts the local Vite + analyze server in the browser.
- `npm run electron:dev` starts that same local server, waits for it, then opens it inside an Electron desktop window.
- `npm run dist:win` builds a Windows installer with electron-builder.

## Development desktop app

From `dashboard-react`:

```powershell
npm install
npm run electron:dev
```

This starts both pieces:

1. `node server.mjs`, which serves the React app and exposes `POST /api/analyze`.
2. Electron, which opens `http://127.0.0.1:5173` in a desktop window.

## Windows installer build

From `dashboard-react`:

```powershell
npm install
npm run dist:win
```

The installer should appear in:

```text
release/
```

Use this faster unpacked build while testing packaging issues:

```powershell
npm run pack:win
```

## How the packaged app works

The packaged app starts its own internal local HTTP server on a random localhost port, then opens that server in an Electron window.

At first launch it copies the analyzer workspace into the app data folder, roughly:

```text
%APPDATA%/Voice Garden/workspace/
```

That workspace contains:

```text
analyze.py
pyproject.toml
uv.lock
recordings.json
dashboard-react/public/
```

The app uses that writable workspace for new recordings, analysis JSON, and dashboard data. This avoids trying to write inside `Program Files`, because Windows considers that a personal insult.

## Current limitation

This installer does **not** bundle Python, uv, or ffmpeg yet.

The packaged app still expects these to be available on the user's PATH:

```powershell
uv --version
ffmpeg -version
```

The Python dependencies are still managed through `uv` using the copied `pyproject.toml` and `uv.lock`.

So this is a real Windows installer for the Electron shell, but not a fully self-contained “works on any clean PC” installer yet. That is the next boss fight.

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

- test the generated installer locally
- add a first-run dependency check for `uv` and `ffmpeg`
- move script storage from `localStorage` to an app data JSON file
- bundle or automate Python/uv/ffmpeg setup later
