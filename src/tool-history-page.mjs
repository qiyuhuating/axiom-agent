import { createHash } from "node:crypto";
import { maskCredentials } from "./credential-mask.ts";
import { HttpError } from "./http.mjs";

export const TOOL_PAGE_SIZE = 16384;
export function toolText(value) {
  return maskCredentials(
    JSON.stringify(
      value,
      (_key, part) => (typeof part === "string" ? maskCredentials(part) : part),
      2,
    ) ?? "",
  );
}
export function toolTextPage(value, offset = 0, revision) {
  const text = toolText(value);
  const digest = createHash("sha256").update(text).digest("hex");
  if (revision !== undefined && revision !== digest)
    throw new HttpError(409, "Tool result changed; reopen its details");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length)
    throw new HttpError(400, "Invalid tool text offset");
  // Offsets count UTF-16 code units; never divide a surrogate pair.
  const lowSurrogate = (index) =>
    text.charCodeAt(index) >= 0xdc00 && text.charCodeAt(index) <= 0xdfff;
  if (lowSurrogate(offset)) throw new HttpError(400, "Invalid tool text boundary");
  let end = Math.min(offset + TOOL_PAGE_SIZE, text.length);
  if (lowSurrogate(end)) end--;
  return {
    text: text.slice(offset, end),
    offset,
    total: text.length,
    next: end < text.length ? end : null,
    revision: digest,
  };
}
