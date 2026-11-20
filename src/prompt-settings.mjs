import { readFile } from "node:fs/promises";

export const DEFAULT_PROMPT =
  "Work in the active workspace. Verify changes with relevant checks and clearly distinguish verified results from assumptions.";
export const PROMPT_LIMIT = 12000;

export async function readPrompt(path) {
  try {
    const { text } = JSON.parse(await readFile(path, "utf8"));
    if (typeof text !== "string" || text.length > PROMPT_LIMIT)
      throw Error("Invalid built-in prompt file");
    return text;
  } catch (error) {
    if (error.code === "ENOENT") return DEFAULT_PROMPT;
    throw error;
  }
}
