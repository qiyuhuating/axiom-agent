import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { openJobStore } from "../src/job-store.mjs";
import { statfsSync } from "node:fs";
function requireSmallMemoryDisk() {
  if (!process.env.TMPDIR) throw Error("Use scripts/check-storage-full.sh");
  const fs = statfsSync(process.env.TMPDIR);
  if (fs.type !== 0x01021994 || fs.bsize * fs.blocks > 32 * 1024 * 1024)
    throw Error("Disk-full tests require a disposable tmpfs of at most 32 MiB");
}
if (process.argv.includes("--disk-full")) requireSmallMemoryDisk();
const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "axiom-storage-"));
let store;
try {
  const jobs = Array.from({ length: 1000 }, (_, id) => ({
    id: String(id),
    status: "completed",
    results: ["x".repeat(1024)],
  }));
  writeFileSync(
    join(dir, "state.json"),
    JSON.stringify({ jobs, plans: {}, schedules: [], mail: [] }),
  );
  store = openJobStore(dir);
  const job = store.state.jobs[0];
  assert.deepEqual(store.state.jobs, jobs);
  if (process.argv.includes("--disk-full")) {
    let i = 0;
    for (;;) {
      try {
        writeFileSync(join(dir, "fill" + i++), Buffer.alloc(65536));
      } catch (e) {
        assert.equal(e.code, "ENOSPC");
        break;
      }
    }
    assert.throws(
      () => store.save([{ ...job, status: "failed", results: ["z".repeat(1048576)] }], false),
      (e) => e.errcode === 13,
    );
    store.close();
    for (let n = 0; n < i; n++) rmSync(join(dir, "fill" + n), { force: true });
    store = openJobStore(dir);
    assert.deepEqual(store.state.jobs, jobs);
    store.save([{ ...job, status: "recovered" }], false);
    store.close();
    store = openJobStore(dir);
    assert.equal(store.state.jobs[0].status, "recovered");
    console.log("SQLITE_FULL: rollback, reopen, write and reopen passed");
  } else {
    const start = Date.now(),
      duration = Number(process.argv[2] || 3600) * 1000;
    let count = 0,
      peak = 0,
      restarts = 0;
    while (Date.now() - start < duration) {
      for (let i = 0; i < 25; i++) {
        job.sequence = ++count;
        store.save([job], false);
      }
      if (count % 10000 === 0) {
        store.close();
        store = openJobStore(dir);
        assert.equal(store.state.jobs[0].sequence, count);
        restarts++;
      }
      peak = Math.max(peak, process.memoryUsage().rss);
      await delay(10);
    }
    store.close();
    store = openJobStore(dir);
    assert.equal(store.state.jobs[0].sequence, count);
    assert.equal(store.state.jobs.length, 1000);
    console.log(
      JSON.stringify({
        seconds: (Date.now() - start) / 1000,
        commits: count,
        restarts,
        peakRSS: peak,
        bytes: statSync(join(dir, "jobs.sqlite")).size,
      }),
    );
  }
} finally {
  store?.close();
  rmSync(dir, { recursive: true, force: true });
}
