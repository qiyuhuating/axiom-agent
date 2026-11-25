import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import test from "node:test";

test("vendored DSH files match the pinned manifest", async () => {
  const root = "vendor/dsh";
  const manifest = JSON.parse(await readFile("vendor-manifest.json", "utf8"));
  const actual = {};
  let bytes = 0;
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    const key = relative(root, file).split(sep).join("/");
    const content = await readFile(file);
    bytes += content.length;
    actual[key] = createHash("sha256").update(content).digest("hex");
  }
  assert.deepEqual(actual, manifest.files);
  assert.ok(bytes <= manifest.baseline.vendorBytes * 0.65, "DSH vendor size exceeds the migration budget");
  for (const file of manifest.runtimeFiles) assert.ok(actual[file], file);
});
