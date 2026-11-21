import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { promisify } from "node:util";
test("child output stays within the runtime log budget", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "axiom-log-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "runtime.log");
  await promisify(execFile)(process.execPath, [
    "src/log-relay.mjs",
    path,
    process.execPath,
    "-e",
    'process.stdout.write(Buffer.alloc(24*1024*1024,65));process.stdout.write("FINISHED");',
  ]);
  assert.ok((await stat(path)).size <= 8 * 1024 * 1024);
  assert.ok((await readFile(path)).subarray(-8).equals(Buffer.from("FINISHED")));
});
