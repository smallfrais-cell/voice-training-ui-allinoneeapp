import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dashboardRoot = __dirname;
const repoRoot = path.resolve(dashboardRoot, "..");
const incomingDir = path.join(dashboardRoot, "public", "incoming-recordings");
const port = Number(process.env.PORT || 5173);
const maxBytes = 100 * 1024 * 1024;

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

function runAnalyzer({ wavPath, label, note }) {
  return new Promise((resolve, reject) => {
    const args = ["run", "analyze.py", wavPath, "--label", label];

    if (note) {
      args.push("--note", note);
    }

    const child = spawn("uv", args, {
      cwd: repoRoot,
      shell: true,
      windowsHide: true,
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

      resolve({ stdout, stderr });
    });
  });
}

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "spa",
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "POST" && url.pathname === "/api/analyze") {
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
      const analyzer = await runAnalyzer({ wavPath, label, note });

      sendJson(res, 200, {
        ok: true,
        file: wavPath,
        stdout: analyzer.stdout,
        stderr: analyzer.stderr,
      });
      return;
    }

    vite.middlewares(req, res, () => {
      res.statusCode = 404;
      res.end("Not found");
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Voice Garden all-in-one running at http://localhost:${port}`);
  console.log("Use Ctrl+C here to stop the local app server.");
});
