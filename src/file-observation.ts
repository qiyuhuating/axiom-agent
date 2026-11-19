import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createTwoFilesPatch } from "diff";
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
    const before = await fileFingerprint(ctx.cwd, event.input.path, true);
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
    if (!entry?.before || entry.overlap || event.isError) {
      pending.delete(event.toolCallId);
      return;
    }
    const after = await fileFingerprint(ctx.cwd, event.input.path, true);
    pending.delete(event.toolCallId);
    if (
      entry.overlap ||
      !after ||
      !after.sha256 ||
      after.path !== entry.before.path ||
      after.sha256 === entry.before.sha256
    )
      return;
    const patch =
      typeof entry.before.text === "string" && typeof after.text === "string"
        ? createTwoFilesPatch("before", "after", entry.before.text, after.text, "", "", {
            context: 3,
            timeout: 50,
            maxEditLength: 2000,
          })
        : undefined;
    return {
      details: {
        ...(event.details && typeof event.details === "object" ? event.details : {}),
        axiomFileChange: {
          path: after.path,
          before: entry.before.sha256,
          after: after.sha256,
          kind: entry.before.sha256 === null ? "created" : "modified",
          source: "direct-tool-observation",
          ...(typeof patch === "string" && Buffer.byteLength(patch) <= 131072 ? { patch } : {}),
        },
      },
    };
  });
}
