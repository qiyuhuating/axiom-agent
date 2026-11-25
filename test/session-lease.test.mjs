import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { RpcClient, SessionManager } from "@earendil-works/pi-coding-agent";

test("Pi CLI and GUI refuse a second writer, allow a different session and recover after a crash", {timeout: 60000}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "axiom-lease-"));
  process.env.AXIOM_CONFIG = join(dir, "config.json");
  process.env.PI_CODING_AGENT_DIR = join(dir, "pi");
  await writeFile(process.env.AXIOM_CONFIG, JSON.stringify({
    workspace: join(dir, "workspace"), sessionDir: join(dir, "sessions"), discoverContext: false,
  }));
  const { config } = await import("../src/config.mjs");
  const { Agent } = await import("../src/agent.mjs");
  function fixture(name) {
    const manager = SessionManager.create(config.workspace, config.sessionDir);
    manager.appendMessage({ role: "user", content: name, timestamp: Date.now() });
    return { path: manager.getSessionFile(), id: manager.getSessionId() };
  }
  const inactive = fixture("CLI session");
  const active = fixture("GUI session");
  const gui = new Agent();
  const clients = [];
  const cli = (file) => {
    const client = new RpcClient({
      cliPath: resolve("scripts/pi.mjs"), cwd: config.workspace, args: ["--session", file],
    });
    clients.push(client);
    return client;
  };
  t.after(async () => {
    await gui.close();
    for (const client of clients) if (client.process) await client.stop();
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  });
  await gui.start();
  await gui.change("switch", active.id);
  const rejected = cli(active.path);
  await assert.rejects(async () => { await rejected.start(); await rejected.getState(); }, /Session in use/);
  const owner = cli(inactive.path);
  await owner.start();
  assert.equal((await owner.getState()).sessionId, inactive.id);
  const before = await readFile(inactive.path);
  await assert.rejects(gui.change("switch", inactive.id), /Session in use/);
  await assert.rejects(gui.change("delete", inactive.id), /Session in use/);
  assert.deepEqual(await readFile(inactive.path), before);
  const exit = once(owner.process, "exit");
  owner.process.kill("SIGKILL");
  await exit;
  await gui.change("switch", inactive.id);
  assert.equal((await gui.state()).sessionId, inactive.id);
  const reopened = cli(active.path);
  await reopened.start();
  assert.equal((await reopened.getState()).sessionId, active.id);
  const recovered = await readFile(inactive.path, "utf8");
  assert.ok(recovered.startsWith(before.toString("utf8")));
  assert.ok(recovered.trimEnd().split("\n").map(JSON.parse).every(entry => entry.type));
});
