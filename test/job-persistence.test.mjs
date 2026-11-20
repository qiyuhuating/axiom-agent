import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

test("a failed DAG root checkpoints its blocked descendants as one transition", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "axiom-dag-persist-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sessionDir = join(dir, "sessions"),
    workspace = join(dir, "workspace");
  process.env.PI_CODING_AGENT_DIR = join(dir, "fixture-profile");
  process.env.AXIOM_CONFIG = join(dir, "config.json");
  await writeFile(process.env.AXIOM_CONFIG, JSON.stringify({ workspace, sessionDir }));
  const { PiClient } = await import("../src/pi-client.mjs");
  t.mock.method(PiClient.prototype, "start", async () => {
    throw Error("Fixture provider unavailable");
  });
  const { jobAction, closeJobs } = await import("../src/jobs.mjs");
  t.after(closeJobs);
  const archive = join(sessionDir, "axiom-jobs", "state.json");
  const rename = fs.renameSync;
  let checkpoints = 0;
  const spy = t.mock.method(fs, "renameSync", (from, to) => {
    if (to === archive) checkpoints++;
    return rename(from, to);
  });
  syncBuiltinESMExports();
  t.after(() => {
    spy.mock.restore();
    syncBuiltinESMExports();
  });
  const nodes = Array.from({ length: 30 }, (_, i) => ({
    id: "node-" + i,
    prompt: "Fixture",
    dependsOn: i ? ["node-" + (i - 1)] : [],
  }));
  const jobs = await jobAction("dag", { nodes });
  for (let i = 0; i < 100 && jobs.at(-1).status !== "blocked"; i++) await delay(10);
  assert.deepEqual(
    jobs.map((j) => j.status),
    ["failed", ...Array(29).fill("blocked")],
  );
  const saved = JSON.parse(await readFile(archive, "utf8"));
  assert.equal(saved.jobs.filter((j) => j.status === "blocked").length, 29);
  assert.equal(checkpoints, 4, "DAG submission, start, failure and blocked descendants");
});
