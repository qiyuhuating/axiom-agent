import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Agent } from "./agent.mjs";
import { config, root } from "./config.mjs";
import { body, HttpError, healthStats, json, requestError, requestUrl } from "./http.mjs";
import { builtinPrompt, setBuiltinPrompt } from "./prompt-store.mjs";
import { ensureRuntime, proxyRuntime, stopIdleOwnedRuntime } from "./runtime-client.mjs";
import {
  inventory,
  permission,
  providerAction,
  providers,
  resourceAction,
  setPermission,
} from "./settings.mjs";
import { toolTextPage } from "./tool-history-page.mjs";
import { gitDiff, listFiles, openFile, saveFile, upload } from "./workspace.mjs";

const gatewayPort = process.env.AXIOM_GATEWAY_PORT;
const gatewaySecret = process.env.AXIOM_GATEWAY_SECRET;
delete process.env.AXIOM_GATEWAY_PORT;
delete process.env.AXIOM_GATEWAY_SECRET;
if (Boolean(gatewayPort) !== Boolean(gatewaySecret))
  throw Error("Incomplete gateway configuration");
const agent = new Agent();
const assets = new Map([
  ["/", ["index.html", "text/html"]],
  ["/app.js", ["app.js", "text/javascript"]],
  ["/app.css", ["app.css", "text/css"]],
  ["/style.css", ["style.css", "text/css"]],
]);
const server = createServer(async (req, res) => {
  const host = req.headers.host;
  if (gatewaySecret && req.headers["x-axiom-gateway-secret"] !== gatewaySecret)
    return json(res, { error: "Private gateway authentication required" }, 403);
  const publicPort = gatewayPort || config.port;
  if (host !== "127.0.0.1:" + publicPort && host !== "localhost:" + publicPort)
    return json(res, { error: "Invalid host" }, 403);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src http: https: blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  try {
    const url = requestUrl(req);
    const path = url.pathname;
    if (req.method === "GET") {
      if (/^\/chunks\/[A-Za-z0-9_-]+\.(js|css)$/.test(path)) {
        const data = await readFile(resolve(root, "public", path.slice(1))).catch((error) => {
          if (error.code === "ENOENT") throw new HttpError(404, "Asset not found");
          throw error;
        });
        res.writeHead(200, {
          "Content-Type": path.endsWith(".css")
            ? "text/css; charset=utf-8"
            : "text/javascript; charset=utf-8",
          "Cache-Control": "public,max-age=31536000,immutable",
        });
        return res.end(data);
      }
      if (assets.has(path)) {
        const [file, type] = assets.get(path);
        const data = await readFile(resolve(root, "public", file));
        res.writeHead(200, {
          "Content-Type": type + "; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        return res.end(data);
      }
      if (path === "/api/health") return json(res, { ok: true, ...healthStats() });
      if (path === "/api/snapshot")
        return json(
          res,
          await agent.snapshot(
            url.searchParams.get("history") === "page"
              ? { from: url.searchParams.get("from") }
              : undefined,
          ),
        );
      if (path === "/api/tool-history") {
        const session = url.searchParams.get("session"),
          id = url.searchParams.get("id");
        if (!session || !id || session.length > 256 || id.length > 512)
          throw new HttpError(400, "Tool history identity required");
        const tool = await agent.toolHistory(session, id);
        if (url.searchParams.get("view") !== "page") return json(res, tool);
        const field = url.searchParams.get("field");
        if (field === null)
          return json(res, { args: toolTextPage(tool.args), result: toolTextPage(tool.result) });
        if (field !== "args" && field !== "result")
          throw new HttpError(400, "Invalid tool history field");
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const revision = url.searchParams.get("revision") ?? undefined;
        if (!revision || !/^[a-f0-9]{64}$/.test(revision))
          throw new HttpError(400, "Tool text revision required");
        return json(res, toolTextPage(tool[field], offset, revision));
      }
      if (path === "/api/history") {
        const before = url.searchParams.get("before");
        if (!before) throw new HttpError(400, "History cursor required");
        return json(res, await agent.olderHistory(before));
      }
      if (path === "/api/state") return json(res, await agent.state());
      if (path === "/api/harness") return json(res, await agent.harnessState());
      if (path === "/api/messages") return json(res, await agent.messages());
      if (path === "/api/models") return json(res, await agent.models());
      if (path === "/api/levels") return json(res, await agent.levels());
      if (path === "/api/sessions") return json(res, await agent.sessions());
      if (path === "/api/files")
        return json(res, await listFiles(url.searchParams.get("path") ?? ""));
      if (path === "/api/file")
        return json(res, await openFile(url.searchParams.get("path") ?? ""));
      if (path === "/api/diff") return json(res, await gitDiff());
      if (path === "/api/session-details")
        return json(res, await agent.sessionDetails(url.searchParams.get("view")));
      if (path === "/api/commands") return json(res, await agent.commands());
      if (path === "/api/dialogs") return json(res, agent.pendingDialogs());
      if (path === "/api/settings")
        return json(res, {
          permission: await permission(),
          maxOutputTokens: config.maxOutputTokens ?? null,
          discoverContext: config.discoverContext ?? false,
          workspace: config.workspace,
        });
      if (path === "/api/providers") return json(res, await providers());
      if (path === "/api/builtin-prompt") return json(res, await builtinPrompt());
      if (path === "/api/resources") return json(res, await inventory());
      if (
        ["/api/jobs", "/api/terminals", "/api/terminal/events", "/api/runtime-health"].includes(
          path,
        )
      )
        return await proxyRuntime(req, res);
      if (path === "/api/events") {
        await agent.start();
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        });
        res.flushHeaders();
        res.write(": ready\n\n");
        const off = agent.subscribe((event) => {
          if (res.writableLength > 4 * 1024 * 1024) res.destroy();
          else res.write("data: " + JSON.stringify(event) + "\n\n");
        });
        void agent.start().catch((error) =>
          res.write(
            "data: " +
              JSON.stringify({
                type: "connection_error",
                error: error.message,
              }) +
              "\n\n",
          ),
        );
        const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
        res.on("close", () => {
          off();
          clearInterval(heartbeat);
        });
        return;
      }
    }
    if (req.method === "POST" && path.startsWith("/api/")) {
      if (req.headers.origin !== "http://" + host || req.headers["x-axiom-client"] !== "1")
        return json(res, { error: "Invalid origin" }, 403);
      if (path === "/api/file-save")
        return json(res, await saveFile(await body(req, 7 * 1024 * 1024)));
      if (path === "/api/upload") return json(res, await upload(await body(req, 12 * 1024 * 1024)));
      if (path === "/api/ui-response") return json(res, await agent.respond(await body(req)));
      if (path === "/api/session-export") {
        const { sessionId } = await body(req, 4096);
        if (typeof sessionId !== "string" || !sessionId) throw Error("Session ID required");
        const directory = await mkdtemp(join(tmpdir(), "axiom-export-"));
        const file = join(directory, "pi-session.html");
        try {
          await agent.exportHtml(sessionId, file);
          res.writeHead(200, {
            "Cache-Control": "no-store",
            "Content-Type": "application/octet-stream",
            "Content-Disposition": 'attachment; filename="pi-session.html"',
            "Content-Length": (await stat(file)).size,
          });
          await pipeline(createReadStream(file), res);
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
        return;
      }
      if (path === "/api/builtin-prompt") {
        const value = await body(req, 160 * 1024);
        return json(res, await agent.exclusiveResourceChange(() => setBuiltinPrompt(value)));
      }
      if (path === "/api/permission") {
        const { mode } = await body(req);
        return json(res, await agent.exclusiveResourceChange(() => setPermission(mode)));
      }
      if (path === "/api/provider-action") {
        const value = await body(req);
        return json(res, await agent.exclusiveResourceChange(() => providerAction(value)));
      }
      if (path === "/api/resource-action") {
        const value = await body(req);
        return json(res, await agent.exclusiveResourceChange(() => resourceAction(value)));
      }
      if (["/api/terminal-action", "/api/job-action"].includes(path))
        return await proxyRuntime(req, res, await body(req));
    }
    if (req.method === "POST" && path === "/api/action") {
      if (req.headers.origin !== "http://" + host || req.headers["x-axiom-client"] !== "1")
        return json(res, { error: "Invalid origin" }, 403);
      const { action, value, images, sessionId } = await body(req, 96 * 1024 * 1024);
      if (action === "prompt" || action === "steer" || action === "followUp") {
        if (typeof value !== "string" || !value.trim())
          return json(res, { error: "Empty input" }, 400);
        if (
          images !== undefined &&
          (!Array.isArray(images) ||
            images.length > 8 ||
            images.some(
              (i) =>
                i?.type !== "image" ||
                !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(i.mimeType) ||
                typeof i.data !== "string" ||
                i.data.length > 12 * 1024 * 1024,
            ))
        )
          throw Error("Invalid image attachments");
        return json(res, await agent[action](value, images, sessionId));
      }
      if (action === "clear-queue") return json(res, await agent.clearQueue());
      if (action === "abort-retry") {
        await agent.abortRetry();
        return json(res, { ok: true });
      }
      if (action === "abort") {
        await agent.abort();
        return json(res, { ok: true });
      }
      return json(res, (await agent.change(action, value)) ?? { ok: true });
    }
    return json(res, { error: "Not found" }, 404);
  } catch (error) {
    requestError("workbench", req, res, error);
  }
});
server.listen(config.port, "127.0.0.1", () => {
  config.port = server.address().port;
  console.log("AXIOM_READY " + config.port);
  console.log("Axiom Agent http://127.0.0.1:" + config.port);
  void ensureRuntime().catch((e) => console.error(e.message));
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close();
  server.closeAllConnections();
  process.stdin.pause();
  try {
    await agent.close();
  } finally {
    await stopIdleOwnedRuntime().catch((error) => console.error("Runtime exit:", error.message));
  }
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
if (process.env.AXIOM_DESKTOP === "1") {
  process.stdin.resume();
  process.stdin.once("end", shutdown);
}
