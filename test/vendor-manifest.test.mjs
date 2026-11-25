import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import test from "node:test";

test("vendored DSH files match the pinned manifest", async () => {
  const root = "vendor/dsh";
  const manifest = JSON.parse(await readFile("vendor-manifest.json", "utf8"));
  const actual = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    const key = relative(root, file).split(sep).join("/");
    actual[key] = createHash("sha256").update(await readFile(file)).digest("hex");
  }
  assert.deepEqual(actual, manifest.files);
  for (const file of manifest.runtimeFiles) assert.ok(actual[file], file);
});
