# Voice Garden desktop shell and Windows installer

This branch builds on the working all-in-one recorder MVP.

The safe fallback remains intact:

- `npm run app` starts the local Vite + analyze server in the browser.
- `npm run electron:dev` starts that same local server, waits for it, then opens it inside an Electron desktop window.
- `npm run dist:win` builds a Windows installer with bundled analyzer bits.

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

That command does three things:

1. Builds the Vite React app.
2. Builds `analyze.py` into `voice-garden-analyzer.exe` with PyInstaller.
3. Builds a Windows NSIS installer with electron-builder.

The installer should appear in:

```text
release/
```

Use this faster unpacked build while testing packaging issues:

```powershell
npm run pack:win
```

## Bundled dependency approach

The installer now bundles:

```text
workspace/bin/voice-garden-analyzer.exe
workspace/bin/ffmpeg.exe
```

`voice-garden-analyzer.exe` is built from `analyze.py` using PyInstaller. That means the installed app should not need the user to have Python or `uv` on PATH for normal analysis.

`ffmpeg.exe` is copied from the npm package `@ffmpeg-installer/ffmpeg`, so `analyze.py` can still convert non-WAV sources if needed. The built-in recorder already saves WAV, but keeping ffmpeg around avoids future suffering. Progress, somehow.

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
bin/voice-garden-analyzer.exe
bin/ffmpeg.exe
dashboard-react/public/
```

The app uses that writable workspace for new recordings, analysis JSON, and dashboard data. This avoids trying to write inside `Program Files`, because Windows considers that a personal insult.

When `bin/voice-garden-analyzer.exe` exists, the local server uses it directly. If it is missing in development, the server falls back to:

```powershell
uv run analyze.py ...
```

## Build requirements

To create the installer on a development machine, you still need:

```powershell
uv --version
npm --version
```

because the build step uses `uv` to run PyInstaller. But users installing the finished app should not need Python or `uv` once the bundled analyzer works.

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

- test `npm run pack:win` locally before making the installer
- test the generated installer on a machine without Python/uv/ffmpeg on PATH
- add a first-run diagnostics panel that shows whether bundled analyzer and ffmpeg were found
- move script storage from `localStorage` to an app data JSON file
