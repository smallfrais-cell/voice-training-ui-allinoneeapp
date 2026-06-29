import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(currentDir, "..");
const manifestPath = path.join(mobileRoot, "android", "app", "src", "main", "AndroidManifest.xml");
const buildGradlePath = path.join(mobileRoot, "android", "app", "build.gradle");

const versionCodeRaw = Number(process.env.ANDROID_VERSION_CODE || process.env.GITHUB_RUN_NUMBER || "1");
const versionCode = Number.isFinite(versionCodeRaw) && versionCodeRaw > 0 ? Math.floor(versionCodeRaw) : 1;
const versionName = process.env.ANDROID_VERSION_NAME || `0.1.${versionCode}`;

await patchManifest();
await patchBuildGradle();

async function patchManifest() {
  let manifest = await readFile(manifestPath, "utf8");
  const permission = '<uses-permission android:name="android.permission.RECORD_AUDIO" />';

  if (!manifest.includes(permission)) {
    manifest = manifest.replace("<application", `${permission}\n\n    <application`);
  }

  await writeFile(manifestPath, manifest);
}

async function patchBuildGradle() {
  let gradle = await readFile(buildGradlePath, "utf8");

  gradle = gradle.replace(/versionCode[ ]+[0-9]+/, `versionCode ${versionCode}`);
  gradle = gradle.replace(/versionName[ ]+"[^"]+"/, `versionName "${versionName}"`);

  await writeFile(buildGradlePath, gradle);
}
