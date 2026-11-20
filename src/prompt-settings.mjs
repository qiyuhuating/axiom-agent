import { readFile } from "node:fs/promises";

export const DEFAULT_PROMPT =
  "Work in the active workspace. Verify changes with relevant checks and clearly distinguish verified results from assumptions.";
export const PROMPT_LIMIT = 12000;

export async function readSavedPrompt(path) {
  try {
    const saved = JSON.parse(await readFile(path, "utf8"));
    if (typeof saved?.text === "string" && saved.text.length <= PROMPT_LIMIT) return saved.text;
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
}

export async function readPrompt(path) {
  return (await readSavedPrompt(path)) ?? DEFAULT_PROMPT;
}
