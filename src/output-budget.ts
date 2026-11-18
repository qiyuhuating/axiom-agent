import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const limit = Number(process.env.AXIOM_MAX_OUTPUT_TOKENS);
  if (!Number.isSafeInteger(limit) || limit <= 0) return;
  pi.on("before_provider_request", (event, ctx) => {
    if (ctx.model?.provider !== "openrouter") return;
    const payload = event.payload;
    if (!payload || typeof payload !== "object") return;
    const body = payload as Record<string, unknown>;
    for (const key of ["max_tokens", "max_completion_tokens"]) {
      if (typeof body[key] === "number" && body[key] > limit) {
        return { ...body, [key]: limit };
      }
    }
  });
}
