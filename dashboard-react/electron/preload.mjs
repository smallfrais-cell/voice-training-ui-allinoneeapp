import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("voiceGardenDesktop", {
  platform: process.platform,
});
