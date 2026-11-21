import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { statfsSync } from "node:fs";
function requireSmallMemoryDisk() {
  if (!process.env.TMPDIR) throw Error("Use scripts/check-storage-full.sh");
  const fs = statfsSync(process.env.TMPDIR);
  if (fs.type !== 0x01021994 || fs.bsize * fs.blocks > 32 * 1024 * 1024)
    throw Error("Disk-full tests require a disposable tmpfs of at most 32 MiB");
}
requireSmallMemoryDisk();
const dir = mkdtempSync(join(process.env.TMPDIR, "runtime-full-")),
  config = join(dir, "config.json");
writeFileSync(
  config,
  JSON.stringify({ workspace: join(dir, "workspace"), sessionDir: join(dir, "sessions") }),
);
const env = { ...process.env, AXIOM_CONFIG: config, PI_CODING_AGENT_DIR: join(dir, "profile") };
const run = (s) =>
  spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import {jobAction,jobState,closeJobs} from "./src/jobs.mjs";' + s,
    ],
    { env, encoding: "utf8", timeout: 90000 },
  );
const write = (key, len) =>
  'await jobAction("plan",{sessionId:' +
  JSON.stringify(key) +
  ',goal:"a".repeat(' +
  len +
  "),items:[]});await closeJobs();";
try {
  let x = run(write("accepted", 100));
  assert.equal(x.status, 0, x.stderr);
  let i = 0;
  for (;;) {
    try {
      writeFileSync(join(dir, "pad" + i++), Buffer.alloc(65536));
    } catch (e) {
      assert.equal(e.code, "ENOSPC");
      break;
    }
  }
  x = run(write("rejected", 1048576));
  assert.equal(x.status, 1, x.stderr);
  assert.match(x.stderr, /Job storage unavailable:.*13/);
  for (let j = 0; j < i; j++) rmSync(join(dir, "pad" + j), { force: true });
  x = run(
    'if(!jobState().plans.accepted||jobState().plans.rejected)throw Error("Incorrect recovery");' +
      write("after", 500),
  );
  assert.equal(x.status, 0, x.stderr);
  x = run('if(!jobState().plans.after)throw Error("Recovery write missing");await closeJobs();');
  assert.equal(x.status, 0, x.stderr);
  console.log(
    "PASS real jobAction: ENOSPC, fail-stop, retained accepted state, no partial action, successful post-restart writes.",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
