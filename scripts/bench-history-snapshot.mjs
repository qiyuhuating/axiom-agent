import { historyPage, historyTools } from "../src/history-page.mjs";

const messages = Array.from({ length: 2000 }, (_, i) => ({
  role: i % 2 ? "assistant" : "user",
  content: [{ type: "text", text: "Message " + i + " " + "representative history text ".repeat(20) }],
}));
const tools = Array.from({ length: 500 }, (_, i) => ({
  role: "toolResult",
  toolCallId: "tool-" + i,
  toolName: "read",
  content: [{ type: "text", text: "x".repeat(4096) }],
}));
const raw = [...messages, ...tools];
const modes = {
  full: () => JSON.stringify({ messages: raw }),
  paged: () => JSON.stringify({
    ...historyPage(raw, "fixture"),
    historyTools: historyTools(raw, { summaries: true }),
  }),
};
const bytes = Object.fromEntries(Object.entries(modes).map(([key, run]) => [key, Buffer.byteLength(run())]));
const samples = { full: [], paged: [] };
for (let i = 0; i < 20; i++) { modes.full(); modes.paged(); }
for (let i = 0; i < 12; i++) {
  for (const key of i % 2 ? ["paged", "full", "full", "paged"] : ["full", "paged", "paged", "full"]) {
    const start = performance.now();
    modes[key]();
    samples[key].push(performance.now() - start);
  }
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(JSON.stringify({
  node: process.version, messages: messages.length, tools: tools.length,
  bytes, medianMs: { full: median(samples.full), paged: median(samples.paged) },
  samplesPerMode: samples.full.length,
}, null, 2));
