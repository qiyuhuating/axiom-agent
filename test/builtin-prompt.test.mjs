import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  await writeFile(path, "{");
  assert.equal((await beforeStart(event)).systemPrompt, event.systemPrompt + "\n\n" + DEFAULT_PROMPT);
});

test("prompt migration, edits and reset survive host restarts and session cleanup", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "axiom-prompt-profile-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const profile = join(dir, "pi");
  const cfg = join(dir, "config.json");
  const sessions = join(dir, "sessions");
  await mkdir(sessions);
  await writeFile(cfg, JSON.stringify({ sessionDir: sessions, workspace: dir, runtimePort: 4798 }));
  await writeFile(join(sessions, "builtin-prompt.json"), JSON.stringify({ text: "Legacy edit" }));
  const run = (operation) => JSON.parse(execFileSync(process.execPath,
    ["--input-type=module", "-e",
      `import { builtinPrompt, setBuiltinPrompt } from "./src/prompt-store.mjs";
       console.log(JSON.stringify(await ${operation}));`],
    { encoding: "utf8", env: { ...process.env, AXIOM_CONFIG: cfg, PI_CODING_AGENT_DIR: profile } }));
  assert.equal(run("builtinPrompt()").text, "Legacy edit");
  const concurrent = run(`Promise.allSettled([
    setBuiltinPrompt({ text: "First", expected: "Legacy edit" }),
    setBuiltinPrompt({ text: "Second", expected: "Legacy edit" })
  ])`);
  assert.equal(concurrent[0].status, "fulfilled");
  assert.equal(concurrent[1].status, "rejected");
  assert.equal(run("builtinPrompt()").text, "First");
  assert.equal(run('setBuiltinPrompt({ text: "Legacy edit", expected: "First" })').text, "Legacy edit");
  assert.equal(run('setBuiltinPrompt({ text: "", expected: "Legacy edit" })').text, "");
  await rm(sessions, { recursive: true });
  assert.equal(run("builtinPrompt()").text, "");
  // Reset also repairs a corrupt override and records use of the bundled default.
  const saved = join(profile, "axiom-builtin-prompt.json");
  await writeFile(saved, "{");
  assert.equal(run("builtinPrompt()").text, DEFAULT_PROMPT);
  assert.equal(run("setBuiltinPrompt({ reset: true, expected: " + JSON.stringify(DEFAULT_PROMPT) + " })").text, DEFAULT_PROMPT);
  assert.deepEqual(JSON.parse(await readFile(saved, "utf8")), { text: null });
  assert.equal(run("builtinPrompt()").text, DEFAULT_PROMPT);
});
