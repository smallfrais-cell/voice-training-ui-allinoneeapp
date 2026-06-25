import { app, BrowserWindow, dialog, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startVoiceGardenServer } from "../appServer.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;
const devAppUrl = process.env.VOICE_GARDEN_URL || "http://127.0.0.1:5173";

let mainWindow = null;
let localServer = null;
let appUrl = devAppUrl;

async function createWindow() {
  mainWindow = new BrowserWindow({
    title: "Voice Garden",
    width: 1320,
    height: 920,
    minWidth: 980,
    minHeight: 720,
    show: false,
    backgroundColor: "#110b18",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (isDev) {
      mainWindow?.webContents.openDevTools({ mode: "detach" });
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  try {
    await mainWindow.loadURL(appUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await dialog.showMessageBox({
      type: "error",
      title: "Voice Garden failed to start",
      message: "Could not load the local Voice Garden app.",
      detail: isDev
        ? `${message}\n\nMake sure the local server is running with npm run app, or use npm run electron:dev to start both together.`
        : `${message}\n\nThe packaged app could not start its internal local server. Rude, frankly.`,
    });
    app.quit();
  }
}

async function startPackagedServer() {
  const workspaceRoot = await prepareWorkspace();
  const staticRoot = path.join(app.getAppPath(), "dist");
  const incomingDir = path.join(workspaceRoot, "dashboard-react", "public", "incoming-recordings");
  const scriptsFile = path.join(workspaceRoot, "scripts.json");

  localServer = await startVoiceGardenServer({
    dashboardRoot: path.dirname(staticRoot),
    repoRoot: workspaceRoot,
    staticRoot,
    incomingDir,
    scriptsFile,
    port: 0,
    dev: false,
  });

  appUrl = localServer.url;
}

async function prepareWorkspace() {
  const workspaceRoot = path.join(app.getPath("userData"), "workspace");
  const resourceWorkspace = path.join(process.resourcesPath, "workspace");

  await fs.mkdir(workspaceRoot, { recursive: true });

  await copyIfMissing(path.join(resourceWorkspace, "analyze.py"), path.join(workspaceRoot, "analyze.py"));
  await copyIfMissing(path.join(resourceWorkspace, "analyze_safe.py"), path.join(workspaceRoot, "analyze_safe.py"));
  await copyIfMissing(path.join(resourceWorkspace, "pyproject.toml"), path.join(workspaceRoot, "pyproject.toml"));
  await copyIfMissing(path.join(resourceWorkspace, "uv.lock"), path.join(workspaceRoot, "uv.lock"));
  await copyIfMissing(path.join(resourceWorkspace, "recordings.json"), path.join(workspaceRoot, "recordings.json"));
  await copyIfMissing(
    path.join(resourceWorkspace, "dashboard-react", "public"),
    path.join(workspaceRoot, "dashboard-react", "public"),
  );

  return workspaceRoot;
}

async function copyIfMissing(source, destination) {
  try {
    await fs.access(destination);
    return;
  } catch {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(source, destination, { recursive: true });
  }
}

app.setName("Voice Garden");

app.whenReady().then(async () => {
  if (!isDev) {
    await startPackagedServer();
  }

  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("before-quit", async () => {
  await localServer?.close().catch(() => undefined);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
