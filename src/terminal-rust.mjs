import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { config, root } from "./config.mjs";
import { runtimePort, runtimeToken } from "./runtime-auth.mjs";

// Experimental backend; the existing job runtime and native Node PTY remain
// the default. A distinct archive prevents two processes writing one history.
export async function createRustTerminalBackend() {
  const port = config.rustTerminalPort;
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    port === runtimePort ||
    port === config.port
  ) {
    throw Error("A distinct rustTerminalPort is required");
  }
  const binary = resolve(
    root,
    config.rustTerminalBinary ||
      (process.platform === "win32" ? "bin/axiom-daemon.exe" : "bin/axiom-daemon"),
  );
  const base = "http://127.0.0.1:" + port;
  const headers = { Authorization: "Bearer " + runtimeToken };
  let starting;
  async function ready() {
    try {
      const r = await fetch(base + "/api/runtime-health", {
        headers,
        signal: AbortSignal.timeout(1000),
      });
      if (!r.ok) return false;
      const info = await r.json();
      return (
        info.ok === true &&
        info.protocol === 1 &&
        info.backend === "rust-pty" &&
        resolve(info.workspace) === resolve(config.workspace)
      );
    } catch {
      return false;
    }
  }
  async function ensure() {
    if (await ready()) return;
    if (!starting) {
      starting = (async () => {
        if (!existsSync(binary)) throw Error("Rust terminal binary not found: " + binary);
        const fd = openSync(resolve(config.sessionDir, "rust-terminal.log"), "a");
        try {
          const child = spawn(binary, [String(port), config.workspace, config.sessionDir], {
            cwd: root,
            env: process.env,
            detached: true,
            windowsHide: true,
            stdio: ["ignore", fd, fd],
          });
          child.on("error", (e) => console.error("Rust terminal startup:", e.message));
          child.unref();
        } finally {
          closeSync(fd);
        }
        for (let i = 0; i < 40; i++) {
          await delay(250);
          if (await ready()) return;
        }
        throw Error("Rust terminal unavailable; inspect rust-terminal.log");
      })().finally(() => {
        starting = undefined;
      });
    }
    return starting;
  }
  async function call(path, body) {
    await ensure();
    const r = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...headers,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const result = await r.json();
    if (!r.ok) throw Error(result.error || "Rust terminal request failed");
    return result;
  }
  await ensure();
  return {
    listTerminals: () => call("/api/terminals"),
    terminalAction: (action, value) => call("/api/terminal-action", { action, value }),
    getTerminal: (id) => call("/api/terminal-snapshot?id=" + encodeURIComponent(id)),
    async streamTerminal(req, res) {
      await ensure();
      const abort = new AbortController();
      const close = () => abort.abort();
      res.on("close", close);
      try {
        const r = await fetch(base + req.url, { headers, signal: abort.signal });
        res.writeHead(r.status, {
          "Content-Type": r.headers.get("content-type") || "application/json",
          "Cache-Control": "no-store",
        });
        if (r.body) await pipeline(Readable.fromWeb(r.body), res);
        else res.end();
      } finally {
        res.off("close", close);
      }
    },
    async closeTerminals() {
      if (!(await ready())) return;
      const r = await fetch(base + "/api/runtime-stop", {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw Error("Rust terminal shutdown failed");
      for (let i = 0; i < 40; i++) {
        await delay(100);
        if (!(await ready())) return;
      }
      throw Error("Rust terminal did not stop");
    },
  };
}
