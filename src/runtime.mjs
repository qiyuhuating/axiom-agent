import { createServer } from "node:http";
import { config } from "./config.mjs";
import { createRuntimeContext } from "./cordis-runtime.mjs";
import { body, healthStats, json, requestError, requestUrl } from "./http.mjs";
import { runtimePort, runtimeToken } from "./runtime-auth.mjs";

let jobs, term, ctx;
const server = createServer(async (req, res) => {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
  if (req.headers.host !== "127.0.0.1:" + runtimePort)
    return json(res, { error: "Invalid host" }, 403);
  if (!ctx) return json(res, { error: "Initializing" }, 503);
  try {
    const url = requestUrl(req);
    const path = url.pathname;
    if (path === "/api/team-tool" && req.method === "POST")
      return json(res, ctx.axiomJobs.teamTool(token, await body(req)));
    if (token !== runtimeToken) return json(res, { error: "Unauthorized" }, 403);
    if (req.method === "GET") {
      if (path === "/api/runtime-health")
        return json(res, {
          ok: true,
          ...healthStats(),
          pid: process.pid,
          protocol: 1,
          workspace: config.workspace,
          sessionDir: config.sessionDir,
          terminalBackend: config.terminalBackend,
        });
      if (path === "/api/jobs") {
        const params = url.searchParams;
        if (!params.has("view")) return json(res, ctx.axiomJobs.state());
        if (params.get("view") === "detail") {
          const job = ctx.axiomJobs.detail(params.get("id") ?? "");
          return job ? json(res, job) : json(res, { error: "Job not found" }, 404);
        }
        const cursor = params.get("cursor"),
          limit = Number(params.get("limit") ?? 50);
        if (
          params.get("view") !== "page" ||
          (cursor !== null &&
            (!/^[1-9][0-9]{0,18}$/.test(cursor) || BigInt(cursor) > 9223372036854775807n)) ||
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 200
        )
          return json(res, { error: "Invalid job page" }, 400);
        return json(res, ctx.axiomJobs.page(cursor, limit, params.get("session") ?? ""));
      }
      if (path === "/api/terminals") return json(res, await ctx.axiomTerminal.listAsync());
      if (path === "/api/terminal/events") {
        if (term.streamTerminal) return await term.streamTerminal(req, res);
        const t = ctx.axiomTerminal.get(url.searchParams.get("id"));
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        const send = (e) => {
          if (res.writableLength > 4 * 1024 * 1024) res.destroy();
          else res.write("data: " + JSON.stringify(e) + "\n\n");
        };
        send({
          snapshot: true,
          data: t.buffer,
          exit: t.exit,
          interrupted: Boolean(t.interrupted),
        });
        t.listeners.add(send);
        const timer = setInterval(() => res.write(": heartbeat\n\n"), 15000);
        res.on("close", () => {
          clearInterval(timer);
          t.listeners.delete(send);
        });
        return;
      }
    }
    if (req.method === "POST") {
      const { action, value } = await body(req);
      if (path === "/api/job-action") return json(res, await ctx.axiomJobs.action(action, value));
      if (path === "/api/terminal-action")
        return json(res, await ctx.axiomTerminal.actionAsync(action, value));
      if (path === "/api/runtime-stop") {
        json(res, { ok: true });
        void shutdown();
        return;
      }
    }
    json(res, { error: "Not found" }, 404);
  } catch (e) {
    requestError("runtime", req, res, e);
  }
});
server.on("error", (e) => {
  console.error(e.message);
  process.exit(1);
});
server.listen(runtimePort, "127.0.0.1", async () => {
  // Only the process that wins the listener may open durable state.
  try {
    process.env.AXIOM_TEAM_PORT = String(runtimePort);
    jobs = await import("./jobs.mjs");
    if (config.terminalBackend === "rust") {
      const { createRustTerminalBackend } = await import("./terminal-rust.mjs");
      term = await createRustTerminalBackend();
    } else {
      term = await import("./terminal.mjs");
    }
    ctx = await createRuntimeContext(jobs, term);
    console.log("Axiom runtime listening " + runtimePort);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    await term?.closeTerminals();
  } catch (error) {
    console.error("Terminal shutdown:", error.message);
  }
  await jobs?.closeJobs();
  await ctx?.fiber.dispose();
  server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
