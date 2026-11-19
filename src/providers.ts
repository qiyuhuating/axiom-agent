import { existsSync, readFileSync } from "node:fs";
export default function (pi) {
  const path = process.env.AXIOM_PROVIDER_FILE;
  if (!path || !existsSync(path)) return;
  for (const p of JSON.parse(readFileSync(path, "utf8"))) {
    pi.registerProvider(p.name, {
      baseUrl: p.baseUrl,
      api: p.api,
      apiKey: p.envKey ? "$" + p.envKey : "local",
      models: [
        {
          id: p.modelId,
          name: p.modelId,
          reasoning: p.reasoning,
          input: p.image ? ["text", "image"] : ["text"],
          contextWindow: p.contextWindow,
          maxTokens: p.maxTokens,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
  }
}
