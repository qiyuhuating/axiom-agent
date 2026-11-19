import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileFingerprint } from "./file-fingerprint.mjs";
export default function (pi: ExtensionAPI) {
  const pending = new Map<
    string,
    { before: Awaited<ReturnType<typeof fileFingerprint>>; overlap: boolean }
  >();
  pi.on("session_start", () => pending.clear());
  pi.on("agent_settled", () => pending.clear());
  pi.on("tool_call", async (event, ctx) => {
    if (!["edit", "write"].includes(event.toolName) || event.parentToolCallId) return;
    const before = await fileFingerprint(ctx.cwd, event.input.path);
    if (!before) return;
    const entry = { before, overlap: false };
    for (const active of pending.values()) {
      if (active.before?.path.toLowerCase() === before.path.toLowerCase()) {
        active.overlap = true;
        entry.overlap = true;
      }
    }
    pending.set(event.toolCallId, entry);
  });
  pi.on("tool_result", async (event, ctx) => {
    const entry = pending.get(event.toolCallId);
    pending.delete(event.toolCallId);
    if (!entry?.before || entry.overlap || event.isError) return;
    const after = await fileFingerprint(ctx.cwd, event.input.path);
    if (
      !after ||
      !after.sha256 ||
      after.path !== entry.before.path ||
      after.sha256 === entry.before.sha256
    )
      return;
    return {
      details: {
        ...(event.details && typeof event.details === "object" ? event.details : {}),
        axiomFileChange: {
          path: after.path,
          before: entry.before.sha256,
          after: after.sha256,
          kind: entry.before.sha256 === null ? "created" : "modified",
          source: "direct-tool-observation",
        },
      },
    };
  });
}
