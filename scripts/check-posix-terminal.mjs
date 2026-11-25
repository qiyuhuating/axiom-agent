import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

async function until(read) {
  for (let i = 0; i < 100; i++) {
    const value = await read();
    if (value) return value;
    await delay(50);
  }
  throw Error("Timed out waiting for native PTY state");
}

test("POSIX PTY reaps its shell and process group after close and daemon crash", {timeout: 30000}, async () => {
  const dir = await mkdtemp(join(tmpdir(), "axiom-native-"));
  const token = randomBytes(32).toString("hex");
  const fixture = join(dir, "shell");
  await writeFile(join(dir, "runtime.token"), token);
  await writeFile(fixture, `#!/bin/sh
sleep 300 &
echo "$$ $!" > pids
while IFS= read -r line; do printf 'received:%s\n' "$line"; done
`, { mode: 0o700 });
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const daemon = spawn(resolve("daemon/target/debug/axiom-daemon"), [String(port), dir, dir], {
    env: {...process.env, AXIOM_PWSH_EXE: fixture}, stdio: ["ignore", "inherit", "inherit"],
  });
  const exited = once(daemon, "exit");
  const base = "http://127.0.0.1:" + port;
  const headers = {Authorization: "Bearer " + token, "Content-Type": "application/json"};
  async function action(action, value) {
    const response = await fetch(base + "/api/terminal-action", {
      method: "POST", headers, body: JSON.stringify({action, value}),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  }
  try {
    await until(async () => {
      try { return (await fetch(base + "/api/runtime-health", {headers})).ok; }
      catch (error) { if(error.cause?.code !== "ECONNREFUSED") throw error; }
    });
    for (const mode of ["close", "crash"]) {
      const {id} = await action("create");
      const pids = await until(async () => {
        try {
          const text = await readFile(join(dir,"pids"),"utf8");
          if (/^\d+ \d+\n$/.test(text)) return text.trim().split(" ").map(Number);
        } catch (error) { if (error.code !== "ENOENT") throw error; }
      });
      await action("input", {id, data:"终端\r"});
      await until(async () => {
        const abort = new AbortController();
        try {
          const stream = await fetch(base + "/api/terminal/events?id=" + id, {headers, signal:abort.signal});
          const {value} = await stream.body.getReader().read();
          return new TextDecoder().decode(value).includes("received:终端");
        } finally { abort.abort(); }
      });
      if (mode === "close") await action("close", {id});
      else { daemon.kill("SIGKILL"); await exited; }
      for (const pid of pids) await until(() => {
        try { process.kill(pid, 0); return false; }
        catch (error) { if (error.code === "ESRCH") return true; throw error; }
      });
      await rm(join(dir,"pids"));
    }
  } finally {
    if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill("SIGKILL");
    await exited;
    await rm(dir,{recursive:true,force:true});
  }
});
