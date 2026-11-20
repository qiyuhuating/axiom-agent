import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config, root } from "./config.mjs";
import { startDetachedRuntime } from "./platform/index.mjs";
import { runtimeToken, runtimeUrl } from "./runtime-auth.mjs";

const auth = { Authorization: "Bearer " + runtimeToken };
async function health() {
  let info;
  try {
    const r = await fetch(runtimeUrl + "/api/runtime-health", {
      headers: auth,
      signal: AbortSignal.timeout(1000),
    });
    if (!r.ok) return false;
    info = await r.json();
  } catch {
    return false;
  }
  if (!info.ok || info.protocol !== 1) return false;
  // Older runtimes predate Rust PTY and therefore imply the Node backend.
  const activeBackend = info.terminalBackend ?? "node";
  if (activeBackend !== config.terminalBackend) {
    throw Error(
      "Running terminal backend is " +
        activeBackend +
        "; configured backend is " +
        config.terminalBackend +
        ". Close active work and stop the existing runtime before switching.",
    );
  }
  return true;
}
let starting;
export async function ensureRuntime() {
  if (await health()) return;
  if (!starting)
    starting = (async () => {
      startDetachedRuntime(root, resolve(config.sessionDir, "runtime.log"));
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 250));
        if (await health()) return;
      }
      throw Error("Independent runtime unavailable; inspect runtime.log");
    })().finally(() => {
      starting = undefined;
    });
  return starting;
}
export async function proxyRuntime(req, res, body) {
  await ensureRuntime();
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
      signal: abort.signal,
    });
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
