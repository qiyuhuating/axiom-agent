import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import approval from "../src/approval.ts";
import providers from "../src/providers.ts";

const exec = promisify(execFile);
async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), "axiom-policy-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function env(t, key, value) {
  const old = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  t.after(() => {
    if (old === undefined) delete process.env[key];
    else process.env[key] = old;
  });
}
test("approval enforces missing, corrupt and explicit permission records on the Pi hook", async (t) => {
  const dir = await directory(t);
  const path = join(dir, "permission.json");
  env(t, "AXIOM_PERMISSION_FILE", path);
  env(t, "AXIOM_WORKSPACE_ROOT", undefined);
  let hook,
    confirmations = 0;
  approval({
    on(_event, fn) {
      hook = fn;
    },
    registerCommand() {},
  });
  const tool = { toolName: "edit", input: {} };
  const ctx = {
    ui: {
      confirm() {
        confirmations++;
        return false;
      },
    },
  };
  assert.equal((await hook(tool, ctx)).block, true);
  assert.equal(confirmations, 1);
  assert.equal(
    (
      await hook(tool, {
        ui: {
          confirm() {
            throw Error("dialog closed");
          },
        },
      })
    ).block,
    true,
  );
  for (const record of ["{", '{"mode":"unknown"}', "{}", '{"mode":"read-only"}']) {
    await writeFile(path, record);
    assert.equal((await hook(tool, ctx)).block, true);
  }
  await writeFile(path, '{"mode":"full"}');
  assert.equal(await hook(tool, ctx), undefined);
  await rm(path);
  process.env.AXIOM_WORKSPACE_ROOT = dir;
  assert.equal((await hook(tool, ctx)).block, true);
  assert.equal(confirmations, 1);
});
test("provider extension skips insecure saved endpoints and loads valid entries", async (t) => {
  const path = join(await directory(t), "providers.json");
  env(t, "AXIOM_PROVIDER_FILE", path);
  await writeFile(
    path,
    JSON.stringify(
      ["http://example.invalid", "https://example.invalid", "http://127.0.0.1:8000"].map(
        (baseUrl, i) => ({ baseUrl, name: "fixture-" + i }),
      ),
    ),
  );
  const registered = [];
  providers({
    registerProvider(name) {
      registered.push(name);
    },
  });
  assert.deepEqual(registered, ["fixture-1", "fixture-2"]);
});
test("startup rejects ambiguous deployment settings and explicit missing configuration", async (t) => {
  const dir = await directory(t),
    cfg = join(dir, "config.json");
  const valid = { workspace: join(dir, "workspace"), sessionDir: join(dir, "sessions") };
  const load = () =>
    exec(process.execPath, ["--input-type=module", "-e", 'import "./src/config.mjs"'], {
      env: { ...process.env, AXIOM_CONFIG: cfg, AXIOM_DESKTOP: "0" },
    });
  await assert.rejects(load(), /ENOENT/);
  for (const [overrides, reason] of [
    [{ schemaVersion: 2 }, /schemaVersion/],
    [{ runtimePort: "4790" }, /runtimePort must/],
    [{ runtimePort: 4789 }, /distinct/],
    [{ port: 0 }, /explicit runtimePort/],
    [{ terminalBackend: "rust", rustTerminalPort: 4790 }, /distinct/],
    [{ discoverContext: "false" }, /boolean/],
    [{ maxOutputTokens: -1 }, /positive integer/],
    [{ sessionDir: join(valid.workspace, "sessions") }, /outside the workspace/],
  ]) {
    await writeFile(cfg, JSON.stringify({ ...valid, ...overrides }));
    await assert.rejects(load(), reason);
  }
});
test("simultaneous hosts share one complete runtime credential and reject damaged state", async (t) => {
  const dir = await directory(t),
    cfg = join(dir, "config.json"),
    sessions = join(dir, "sessions");
  await mkdir(sessions);
  await writeFile(cfg, JSON.stringify({ workspace: join(dir, "workspace"), sessionDir: sessions }));
  const load = () =>
    exec(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import {runtimeToken} from "./src/runtime-auth.mjs"; import {createHash} from "node:crypto"; console.log(createHash("sha256").update(runtimeToken).digest("hex"));',
      ],
      { env: { ...process.env, AXIOM_CONFIG: cfg, AXIOM_DESKTOP: "0" } },
    );
  const fingerprints = await Promise.all(Array.from({ length: 6 }, load));
  assert.equal(new Set(fingerprints.map((x) => x.stdout)).size, 1);
  assert.deepEqual(await readdir(sessions), ["runtime.token"]);
  const path = join(sessions, "runtime.token");
  assert.match(await readFile(path, "utf8"), /^[0-9a-f]{64}$/);
  await writeFile(path, "");
  await assert.rejects(load(), /Invalid runtime.token/);
  assert.equal(await readFile(path, "utf8"), "");
});
