import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(__dirname, "..");
const wwwRoot = path.join(mobileRoot, "www");

const assets = [
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "sw.js",
  "icon.svg",
];

await rm(wwwRoot, { recursive: true, force: true });
await mkdir(wwwRoot, { recursive: true });

for (const asset of assets) {
  await cp(path.join(mobileRoot, asset), path.join(wwwRoot, asset), { recursive: true });
}

console.log(`Prepared Capacitor web assets in ${wwwRoot}`);
