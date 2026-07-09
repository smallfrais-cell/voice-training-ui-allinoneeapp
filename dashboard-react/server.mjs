import path from "node:path";
import { fileURLToPath } from "node:url";
import { startVoiceGardenServer } from "./appServer.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dashboardRoot = __dirname;
const repoRoot = path.resolve(dashboardRoot, "..");
const incomingDir = path.join(dashboardRoot, "public", "incoming-recordings");
const port = Number(process.env.PORT || 5173);

const appServer = await startVoiceGardenServer({
  dashboardRoot,
  repoRoot,
  incomingDir,
  port,
  dev: true,
});

console.log(`Voice Garden all-in-one running at ${appServer.url}`);
console.log("Use Ctrl+C here to stop the local app server.");
