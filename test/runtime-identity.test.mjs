import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("runtime probes share startup work and reject stale services before forwarding", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "axiom-identity-"));
  const workspace = join(dir, "workspace"),
    sessionDir = join(dir, "sessions");
  let status = 503,
    checks = 0,
    activeWorkspace = workspace;
  const runtime = createServer((_req, res) => {
    checks++;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        protocol: 1,
        terminalBackend: "node",
        workspace: activeWorkspace,
        sessionDir,
      }),
    );
    if (status === 503) status = 200;
  });
  runtime.listen(0, "127.0.0.1");
  await once(runtime, "listening");
  t.after(async () => {
    await new Promise((resolve) => runtime.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  process.env.AXIOM_CONFIG = join(dir, "config.json");
  await writeFile(
    process.env.AXIOM_CONFIG,
    JSON.stringify({ workspace, sessionDir, runtimePort: runtime.address().port }),
  );
  const { ensureRuntime } = await import("../src/runtime-client.mjs");
  const result = await Promise.all(Array.from({ length: 8 }, ensureRuntime));
  assert.equal(checks, 2);
  assert.ok(result.every((state) => state.workspace === workspace));
  activeWorkspace = join(dir, "other");
  await assert.rejects(ensureRuntime(), { status: 503, message: /identity/ });
  status = 403;
  await assert.rejects(ensureRuntime(), { status: 503, message: /credential/ });
  assert.equal(checks, 4);
});
