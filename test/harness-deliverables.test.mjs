import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveDeliverables } from "../src/deliverables.mjs";
import register from "../src/deliverables.ts";

test("present_files registers a Pi tool and validates real workspace artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "axiom-delivery-"));
  try {
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    await writeFile(join(workspace, "result.txt"), "hello");
    await writeFile(join(root, "outside.txt"), "outside");
    const files = [{ path: "result.txt", size: 5 }];
    assert.deepEqual(await resolveDeliverables(workspace, ["result.txt", "./result.txt"]), files);
    await assert.rejects(resolveDeliverables(workspace, ["../outside.txt"]), /Outside workspace/);
    await assert.rejects(resolveDeliverables(workspace, [join(workspace, "result.txt")]), /relative/);
    await assert.rejects(resolveDeliverables(workspace, ["."]));
    await assert.rejects(resolveDeliverables(workspace, Array(21).fill("result.txt")), /1 to 20/);
    let tool;
    register({ registerTool: t => { tool = t; } });
    assert.equal(tool.name, "present_files");
    const result = await tool.execute("id", { paths: ["result.txt"] }, undefined, undefined, { cwd: workspace });
    assert.deepEqual(result.details, {kind: "axiom-deliverables-v1", files});
  } finally { await rm(root, {recursive: true, force: true}); }
});
