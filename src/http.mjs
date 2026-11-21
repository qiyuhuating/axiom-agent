import { randomUUID } from "node:crypto";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const errors = { client: 0, server: 0 };
export function healthStats() {
  return { uptimeSeconds: Math.floor(process.uptime()), httpErrors: { ...errors } };
}
export function json(res, value, status = 200) {
  if (status >= 500) errors.server++;
  else if (status >= 400) errors.client++;
  const data = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(data);
}
export function requestUrl(req) {
  try {
    if (!req.url.startsWith("/") || req.url.startsWith("//") || req.url.includes("\\"))
      throw Error();
    return new URL(req.url, "http://localhost");
  } catch {
    throw new HttpError(400, "Invalid request target");
  }
}
export async function body(req, limit = 2 * 1024 * 1024) {
  if (Number(req.headers["content-length"]) > limit) throw new HttpError(413, "Request too large");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > limit) throw new HttpError(413, "Request too large");
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "Expected a JSON object");
  return value;
}
export function requestError(service, req, res, error) {
  if (res.destroyed) return;
  // Existing domain operations use plain Error for user-facing validation.
  const status =
    error instanceof HttpError
      ? error.status
      : error.code !== undefined || error instanceof SyntaxError
        ? 500
        : 400;
  const requestId = randomUUID();
  const code =
    typeof error.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : undefined;
  console.error(
    JSON.stringify({
      time: new Date().toISOString(),
      event: "request_error",
      service,
      method: req.method,
      status,
      code,
      requestId,
    }),
  );
  if (res.headersSent) {
    res.destroy();
    return;
  }
  // Discard the rest without buffering so a client still uploading can receive the 413.
  if (status === 413) req.resume();
  res.setHeader("X-Request-Id", requestId);
  const message = status === 500 ? "Internal service error" : error.message;
  json(res, { error: message, requestId }, status);
}
