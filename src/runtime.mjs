import { createServer } from "node:http";
import { config } from "./config.mjs";
import { createRuntimeContext } from "./cordis-runtime.mjs";
import { runtimePort, runtimeToken } from "./runtime-auth.mjs";

let jobs, term, ctx;
function json(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
async function body(req) {
  let text = "";
  req.setEncoding("utf8");
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 2 * 1024 * 1024) throw Error("Runtime request too large");
  }
  return JSON.parse(text);
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost"),
    path = url.pathname,
    token = req.headers.authorization?.replace(/^Bearer /, "");
  if (req.headers.host !== "127.0.0.1:" + runtimePort)
    return json(res, { error: "Invalid host" }, 403);
  if (!ctx) return json(res, { error: "Initializing" }, 503);
  try {
    if (path === "/api/team-tool" && req.method === "POST")
      return json(res, ctx.axiomJobs.teamTool(token, await body(req)));
    if (token !== runtimeToken) return json(res, { error: "Unauthorized" }, 403);
    if (req.method === "GET") {
      if (path === "/api/runtime-health")
        return json(res, { ok: true, pid: process.pid, protocol: 1 });
      if (path === "/api/jobs") return json(res, ctx.axiomJobs.state());
      if (path === "/api/terminals") return json(res, await ctx.axiomTerminal.list());
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
        return json(res, await ctx.axiomTerminal.action(action, value));
      if (path === "/api/runtime-stop") {
        json(res, { ok: true });
        void shutdown();
        return;
      }
    }
    json(res, { error: "Not found" }, 404);
  } catch (e) {
    if (!res.headersSent) json(res, { error: e.message }, 400);
    else res.destroy();
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
