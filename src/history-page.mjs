import { createHash } from "node:crypto";
import { HttpError } from "./http.mjs";

export const HISTORY_PAGE_SIZE = 80;
export function visibleHistory(messages) {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role,
      content: Array.isArray(m.content)
        ? m.content
            .filter((part) => part.type === "text")
            .map((part) => ({ type: "text", text: part.text }))
        : m.content,
      ...(m.errorMessage ? { errorMessage: m.errorMessage } : {}),
      ...(m.timestamp !== undefined ? { timestamp: m.timestamp } : {}),
    }));
}
function prefixDigest(messages, end) {
  const hash = createHash("sha256");
  for (let i = 0; i < end; i++) hash.update(JSON.stringify(messages[i])).update("\n");
  return hash.digest("hex");
}
function cursorFor(messages, sessionId, index) {
  return Buffer.from(
    JSON.stringify({ sessionId, index, hash: prefixDigest(messages, index) }),
  ).toString("base64url");
}
function readCursor(messages, sessionId, cursor) {
  let value;
  try {
    if (typeof cursor !== "string" || cursor.length > 1024) throw Error();
    value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid history cursor");
  }
  if (
    value?.sessionId !== sessionId ||
    !Number.isSafeInteger(value.index) ||
    value.index < 0 ||
    value.index > messages.length ||
    value.hash !== prefixDigest(messages, value.index)
  )
    throw new HttpError(409, "History changed; reload the active session");
  return value.index;
}
export function historyPage(messages, sessionId, { before, from } = {}) {
  const visible = visibleHistory(messages);
  let end = visible.length;
  let start = Math.max(0, end - HISTORY_PAGE_SIZE);
  if (before) {
    end = readCursor(visible, sessionId, before);
    start = Math.max(0, end - HISTORY_PAGE_SIZE);
  } else if (from) {
    try {
      start = readCursor(visible, sessionId, from);
    } catch (error) {
      if (error.status !== 409) throw error;
      // Session branch changed or history compacted. Replace, never merge.
    }
  }
  const current = cursorFor(visible, sessionId, start);
  return {
    messages: visible.slice(start, end),
    history: {
      sessionId,
      start,
      total: visible.length,
      from: current,
      before: start > 0 ? current : null,
    },
  };
}

// Preserve tool-call pairing and original turn numbers even if the
// corresponding assistant text is not part of the visible page.
export function historyTools(messages, { summaries = false, only } = {}) {
  let turn = 0;
  const tools = new Map();
  const merge = (id, patch) => {
    if (only !== undefined && id !== only) return;
    const old = tools.get(id) ?? { id, name: "tool", finished: false, failed: false };
    if (summaries) {
      delete patch.args;
      delete patch.result;
      const details = patch.details;
      patch.details = details?.axiomFileChange
        ? { axiomFileChange: details.axiomFileChange }
        : details?.kind === "axiom-deliverables-v1"
          ? { kind: details.kind, files: details.files }
          : undefined;
      patch.detailDeferred = true;
    }
    tools.set(id, {
      ...old,
      ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
    });
  };
  for (const m of messages) {
    if (m.role === "user") turn++;
    if (Array.isArray(m.content)) {
      for (const c of m.content)
        if (c.type === "toolCall") merge(c.id, { name: c.name, args: c.arguments, turn });
    }
    if (m.role === "toolResult" && m.toolCallId)
      merge(m.toolCallId, {
        name: m.toolName,
        result: m.content,
        details: m.details,
        failed: !!m.isError,
        finished: true,
      });
  }
  return { tools: [...tools.values()], turn };
}
