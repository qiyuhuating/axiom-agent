import { randomUUID } from "node:crypto";
import { access, link, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { config } from "./config.mjs";
import { DEFAULT_PROMPT, PROMPT_LIMIT, readPrompt, readSavedPrompt } from "./prompt-settings.mjs";

export const builtinPromptPath = resolve(getAgentDir(), "axiom-builtin-prompt.json");

async function persist(text, migrating = false) {
  await mkdir(dirname(builtinPromptPath), { recursive: true });
  const temp = builtinPromptPath + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temp, JSON.stringify({ text }), { flag: "wx", mode: 0o600, flush: true });
    if (migrating) {
      // Publish the legacy edit only if another host has not already saved one.
      await link(temp, builtinPromptPath);
    } else {
      await rename(temp, builtinPromptPath);
    }
  } catch (error) {
    if (!migrating || error.code !== "EEXIST") throw error;
  } finally {
    await unlink(temp).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

try {
  await access(builtinPromptPath);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const legacy = await readSavedPrompt(resolve(config.sessionDir, "builtin-prompt.json"));
  if (legacy !== undefined) await persist(legacy, true);
}

export async function builtinPrompt() {
  return {
    text: await readPrompt(builtinPromptPath),
    defaultText: DEFAULT_PROMPT,
    limit: PROMPT_LIMIT,
  };
}

let pendingWrite = Promise.resolve();

export function setBuiltinPrompt(value) {
  // Keep the comparison and atomic publish in the same serialized operation.
  const write = pendingWrite.then(() => updateBuiltinPrompt(value));
  pendingWrite = write.then(
    () => {},
    () => {},
  );
  return write;
}

async function updateBuiltinPrompt({ text, expected, reset = false }) {
  if (
    typeof reset !== "boolean" ||
    typeof expected !== "string" ||
    (!reset && (typeof text !== "string" || text.length > PROMPT_LIMIT))
  )
    throw Error("Invalid built-in prompt");
  const current = await readPrompt(builtinPromptPath);
  if (expected !== current)
    throw Error("The prompt changed in another window. Reload it and try again.");
  if (reset || text !== current) await persist(reset ? null : text);
  return { text: reset ? DEFAULT_PROMPT : text, defaultText: DEFAULT_PROMPT, limit: PROMPT_LIMIT };
}
