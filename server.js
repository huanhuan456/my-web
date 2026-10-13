const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = __dirname;
const dataDirectory = path.resolve(getOption("--data-dir", path.join(root, ".local-data")));
const dataFile = path.join(dataDirectory, "child-progress.json");
let stateWriteQueue = Promise.resolve();
const publicFiles = new Set([
  "index.html", "styles.css", "android.js", "app.js", "pwa.js", "sw.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png",
  "dist/points-card-1.0.0.apk"
]);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".apk": "application/vnd.android.package-archive",
  ".svg": "image/svg+xml"
};

function getOption(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function sendJson(response, statusCode, value, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  response.end(JSON.stringify(value));
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isValidState(value) {
  return value && Array.isArray(value.courses) && Array.isArray(value.customCourses) && Array.isArray(value.activities);
}

async function readSavedState() {
  try {
    return JSON.parse(await fs.readFile(dataFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function stateEtag(value) {
  return `"${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}"`;
}

async function handleApi(request, response) {
  if (request.method === "GET" && request.url === "/api/state") {
    try {
      const saved = await readSavedState();
      return sendJson(response, 200, saved, { ETag: stateEtag(saved) });
    } catch (error) {
      return sendJson(response, 500, { error: "Unable to read saved data" });
    }
  }

  if (request.method === "PUT" && request.url === "/api/state") {
    try {
      const value = await readRequestBody(request);
      if (!isValidState(value)) return sendJson(response, 400, { error: "Invalid state" });
      stateWriteQueue = stateWriteQueue.catch(() => {}).then(async () => {
        const current = await readSavedState();
        if (request.headers["if-match"] && request.headers["if-match"] !== stateEtag(current)) {
          return sendJson(response, 412, { error: "State changed; reload and merge before saving" });
        }
        await fs.mkdir(dataDirectory, { recursive: true });
        const temporaryFile = `${dataFile}.tmp`;
        await fs.writeFile(temporaryFile, JSON.stringify(value, null, 2), "utf8");
        await fs.rename(temporaryFile, dataFile);
        sendJson(response, 200, { saved: true }, { ETag: stateEtag(value) });
      });
      await stateWriteQueue;
      return;
    } catch (error) {
      const statusCode = error.message === "Payload too large" ? 413 : error instanceof SyntaxError ? 400 : 500;
      return sendJson(response, statusCode, { error: "Unable to save data" });
    }
  }

  sendJson(response, 404, { error: "Not found" });
}

async function handleStatic(request, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    response.writeHead(400);
    return response.end("Bad request");
  }
  if (pathname.includes("\\") || pathname.split("/").some((part) => part.startsWith("."))) {
    response.writeHead(404);
    return response.end("Not found");
  }
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!publicFiles.has(relativePath)) {
    response.writeHead(404);
    return response.end("Not found");
  }
  const filePath = path.resolve(root, relativePath);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(404);
    return response.end("Not found");
  }
  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500);
    response.end(error.code === "ENOENT" ? "Not found" : "Unable to read file");
  }
}

const host = getOption("--host", "127.0.0.1");
const port = Number(getOption("--port", "4173"));
function handleRequest(request, response) {
  if (request.url.startsWith("/api/")) {
    handleApi(request, response);
  } else if (request.method === "GET" || request.method === "HEAD") {
    handleStatic(request, response);
  } else {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method not allowed");
  }
}

async function start() {
  const cert = getOption("--cert", "");
  const key = getOption("--key", "");
  if (Boolean(cert) !== Boolean(key)) throw new Error("HTTPS requires both --cert and --key");
  const server = cert
    ? https.createServer({ cert: await fs.readFile(cert), key: await fs.readFile(key) }, handleRequest)
    : http.createServer(handleRequest);
  server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, host, () => {
    console.log(`积分卡运行中：${cert ? "https" : "http"}://${host}:${server.address().port}`);
    console.log(`记录文件：${dataFile}`);
  });
}

start().catch((error) => { console.error(error.message); process.exitCode = 1; });
