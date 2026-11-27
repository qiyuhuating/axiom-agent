import { randomUUID } from "node:crypto";
import { relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config, root } from "./config.mjs";
import { HttpError } from "./http.mjs";
import { startDetachedRuntime } from "./platform/index.mjs";
import { runtimeToken, runtimeUrl } from "./runtime-auth.mjs";

const auth = { Authorization: "Bearer " + runtimeToken };
const owner = randomUUID();
let launchedByHost = false;
let closing = false;
async function probe() {
  let response;
  try {
    response = await fetch(runtimeUrl + "/api/runtime-health", {
      headers: auth,
      redirect: "error",
      signal: AbortSignal.timeout(1000),
    });
  } catch (error) {
    if (error.cause?.code === "ECONNREFUSED") return "absent";
    if (error.name === "TimeoutError") return "initializing";
    throw new HttpError(503, "Runtime health check failed; inspect runtime.log");
  }
  if (response.status === 503) {
    await response.body?.cancel();
    return "initializing";
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(503, "Runtime port is occupied or its credential does not match");
  }
  const info = await response.json().catch(() => null);
  if (
    info?.ok !== true ||
    info.protocol !== 1 ||
    typeof info.workspace !== "string" ||
    relative(config.workspace, info.workspace) !== "" ||
    typeof info.sessionDir !== "string" ||
    relative(config.sessionDir, info.sessionDir) !== "" ||
    !["node", "rust"].includes(info.terminalBackend)
  ) {
    throw new HttpError(
      503,
      "Running runtime identity or configuration differs. Finish active work and stop the previous runtime before restarting.",
    );
  }
  if (info.terminalBackend !== config.terminalBackend) {
    throw new HttpError(
      503,
      "Running terminal backend is " +
        info.terminalBackend +
        "; configured backend is " +
        config.terminalBackend +
        ". Close active work and stop the existing runtime before switching.",
    );
  }
  return info;
}
async function connect() {
  let launched = false;
  const deadline = Date.now() + 12000;
  do {
    const result = await probe();
    if (typeof result === "object") return result;
    if (result === "absent" && !launched) {
      if (closing) throw new HttpError(503, "Workbench is closing");
      startDetachedRuntime(root, resolve(config.sessionDir, "runtime.log"), {
        ...process.env,
        AXIOM_RUNTIME_OWNER: owner,
      });
      launchedByHost = true;
      launched = true;
    }
    await new Promise((done) => setTimeout(done, 250));
  } while (Date.now() < deadline);
  throw new HttpError(503, "Independent runtime unavailable; inspect runtime.log");
}
let starting;
export async function stopIdleOwnedRuntime() {
  closing = true;
  if (config.keepRuntimeOnExit === true) return;
  if (starting && launchedByHost) await starting;
  if (!launchedByHost) return;
  if ((await probe()) === "absent") return;
  const response = await fetch(runtimeUrl + "/api/runtime-stop-idle", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ owner }),
    redirect: "error",
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) throw Error("Idle runtime shutdown rejected");
  const result = await response.json();
  if (!result.stopping) return;
  const deadline = Date.now() + 3500;
  while (Date.now() < deadline) {
    if ((await probe()) === "absent") return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error("Owned idle runtime did not stop before desktop exit");
}
export function ensureRuntime() {
  if (closing) throw new HttpError(503, "Workbench is closing");
  starting ??= connect().finally(() => {
    starting = undefined;
  });
  return starting;
}
export async function proxyRuntime(req, res, body) {
  const health = await ensureRuntime();
  if (res.destroyed) return;
  if (req.method === "GET" && req.url === "/api/runtime-health") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(health));
    return;
  }
  const abort = new AbortController();
  const onClose = () => abort.abort();
  res.on("close", onClose);
  try {
    const r = await fetch(runtimeUrl + req.url, {
      method: req.method,
      headers: {
        ...auth,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal:
        req.url.split("?")[0] === "/api/terminal/events"
          ? abort.signal
          : AbortSignal.any([abort.signal, AbortSignal.timeout(120000)]),
    }).catch((error) => {
      if (error.name === "TimeoutError")
        throw new HttpError(504, "Runtime request timed out. Check its state before retrying.");
      throw new HttpError(502, "Runtime connection lost. Check its state before retrying.");
    });
    const requestId = r.headers.get("x-request-id");
    if (requestId) res.setHeader("X-Request-Id", requestId);
    res.writeHead(r.status, {
      "Content-Type": r.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    });
    if (r.body) await pipeline(Readable.fromWeb(r.body), res);
    else res.end();
  } finally {
    res.off("close", onClose);
  }
}
