import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";

const maxBytes = 100 * 1024 * 1024;

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".wav", "audio/wav"],
  [".mp3", "audio/mpeg"],
  [".m4a", "audio/mp4"],
]);

export async function startVoiceGardenServer(options) {
  const {
    repoRoot,
    staticRoot = null,
    incomingDir,
    port = 5173,
    host = "127.0.0.1",
    dev = false,
  } = options;

  const vite = dev ? await createViteMiddlewareServer() : null;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      if (req.method === "POST" && url.pathname === "/api/analyze") {
        await handleAnalyzeRequest(req, res, { repoRoot, incomingDir, url });
        return;
      }

      if (vite) {
        vite.middlewares(req, res, () => {
          res.statusCode = 404;
          res.end("Not found");
        });
        return;
      }

      await serveStaticRequest(req, res, { repoRoot, staticRoot });
    } catch (error) {
      const payload = normaliseAnalyzerError(error);
      console.error("Analyze request failed:", payload.error);
      if (payload.stderr.trim()) {
        console.error(payload.stderr.trim());
      }
      if (payload.stdout.trim()) {
        console.log(payload.stdout.trim());
      }
      sendJson(res, 500, payload);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const url = `http://${host}:${actualPort}`;

  return {
    server,
    url,
    async close() {
      await vite?.close();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function createViteMiddlewareServer() {
  const { createServer } = await import("vite");
  return createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
}

async function handleAnalyzeRequest(req, res, { repoRoot, incomingDir, url }) {
  const label = (url.searchParams.get("label") || "").trim();
  const note = (url.searchParams.get("note") || "").trim();

  if (!label) {
    sendJson(res, 400, { error: "Missing take label." });
    return;
  }

  const body = await readRequestBody(req);
  if (!body.length) {
    sendJson(res, 400, { error: "Missing WAV recording body." });
    return;
  }

  await fs.mkdir(incomingDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const wavPath = path.join(incomingDir, `${stamp}-${safeFilePart(label)}.wav`);

  await fs.writeFile(wavPath, body);
  const analyzer = await runAnalyzer({ repoRoot, wavPath, label, note });

  sendJson(res, 200, {
    ok: true,
    file: wavPath,
    stdout: analyzer.stdout,
    stderr: analyzer.stderr,
  });
}

async function serveStaticRequest(req, res, { repoRoot, staticRoot }) {
  if (!staticRoot) {
    res.statusCode = 404;
    res.end("Static root is not configured.");
    return;
  }

  const rawPath = new URL(req.url || "/", "http://localhost").pathname;
  const requestPath = rawPath === "/" ? "/index.html" : decodeURIComponent(rawPath);

  const publicRoot = path.join(repoRoot, "dashboard-react", "public");
  const publicCandidate = path.join(publicRoot, stripLeadingSlash(requestPath));
  const distCandidate = path.join(staticRoot, stripLeadingSlash(requestPath));

  if (!requestPath.startsWith("/assets/") && (await isFile(publicCandidate))) {
    streamFile(publicCandidate, res);
    return;
  }

  if (await isFile(distCandidate)) {
    streamFile(distCandidate, res);
    return;
  }

  const indexPath = path.join(staticRoot, "index.html");
  if (await isFile(indexPath)) {
    streamFile(indexPath, res);
    return;
  }

  res.statusCode = 404;
  res.end("Not found");
}

function streamFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": contentTypes.get(ext) || "application/octet-stream",
  });
  createReadStream(filePath).pipe(res);
}

async function isFile(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function stripLeadingSlash(value) {
  return value.replace(/^[/\\]+/, "");
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function safeFilePart(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "take";
}

async function readRequestBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error("Recording is too large. Try a shorter take.");
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function normaliseAnalyzerError(error) {
  if (error && typeof error === "object") {
    const maybe = error;
    const nestedError = maybe.error instanceof Error ? maybe.error.message : String(maybe.error || "");
    return {
      error: nestedError || "Analyzer failed.",
      stdout: typeof maybe.stdout === "string" ? maybe.stdout : "",
      stderr: typeof maybe.stderr === "string" ? maybe.stderr : "",
    };
  }

  return {
    error: error instanceof Error ? error.message : String(error),
    stdout: "",
    stderr: "",
  };
}

function runAnalyzer({ repoRoot, wavPath, label, note }) {
  return new Promise((resolve, reject) => {
    const args = ["run", "analyze.py", wavPath, "--label", label];

    if (note) {
      args.push("--note", note);
    }

    console.log(`Analyzing ${wavPath} as “${label}”...`);

    const child = spawn("uv", args, {
      cwd: repoRoot,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject({ error, stdout, stderr });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject({
          error: new Error(`Analyzer exited with code ${code}`),
          stdout,
          stderr,
        });
        return;
      }

      if (stdout.trim()) {
        console.log(stdout.trim());
      }
      if (stderr.trim()) {
        console.error(stderr.trim());
      }

      resolve({ stdout, stderr });
    });
  });
}
