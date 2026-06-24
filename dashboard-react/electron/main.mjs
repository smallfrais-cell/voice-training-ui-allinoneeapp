import { app, BrowserWindow, dialog, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appUrl = process.env.VOICE_GARDEN_URL || "http://127.0.0.1:5173";
const isDev = !app.isPackaged;

let mainWindow = null;

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
      detail: `${message}\n\nMake sure the local server is running with npm run app, or use npm run electron:dev to start both together.`,
    });
    app.quit();
  }
}

app.setName("Voice Garden");

app.whenReady().then(async () => {
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
