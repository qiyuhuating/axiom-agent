import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readPrompt } from "./prompt-settings.mjs";

export default function (pi: ExtensionAPI) {
  const path = process.env.AXIOM_BUILTIN_PROMPT_FILE;
  if (!path) return;
  pi.on("before_agent_start", async (event) => {
    const text = await readPrompt(path);
    if (text.trim()) return { systemPrompt: event.systemPrompt + "\n\n" + text };
  });
}
