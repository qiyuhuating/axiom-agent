import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import register from "../src/builtin-prompt.ts";
import { DEFAULT_PROMPT } from "../src/prompt-settings.mjs";

test("the Pi extension reads prompt edits at the next turn and preserves Pi instructions", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "axiom-prompt-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "builtin-prompt.json");
  process.env.AXIOM_BUILTIN_PROMPT_FILE = path;
  let beforeStart;
  try {
    register({ on(event, callback) {
      assert.equal(event, "before_agent_start");
      beforeStart = callback;
    } });
  } finally {
    delete process.env.AXIOM_BUILTIN_PROMPT_FILE;
  }
  const event = { systemPrompt: "Pi system settings" };
  assert.equal((await beforeStart(event)).systemPrompt, event.systemPrompt + "\n\n" + DEFAULT_PROMPT);
  await writeFile(path, JSON.stringify({ text: "Answer concisely" }));
  assert.equal((await beforeStart(event)).systemPrompt, "Pi system settings\n\nAnswer concisely");
  await writeFile(path, JSON.stringify({ text: "" }));
  assert.equal(await beforeStart(event), undefined);
});
