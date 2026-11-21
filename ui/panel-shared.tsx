import type React from "react";
export async function api(path: string, data?: unknown) {
  const r = await fetch(
    "/api/" + path,
    data === undefined
      ? { signal: AbortSignal.timeout(30000) }
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Axiom-Client": "1",
          },
          body: JSON.stringify(data),
        },
  );
  // Gateway failures are allowed to be plain text; do not hide their HTTP status behind a JSON parse error.
  const text = await r.text();
  let value: ReturnType<typeof JSON.parse>;
  try {
    value = JSON.parse(text);
  } catch {
    throw Error(
      "API " + path + ": " + r.status + " " + (r.statusText || "Invalid server response"),
    );
  }
  if (!r.ok) {
    const message = value?.error || "API " + path + ": " + r.status + " " + r.statusText;
    const id = r.headers.get("x-request-id");
    throw Error(id && r.status >= 500 ? message + "（请求编号 " + id + "）" : message);
  }
  return value;
}
export const terminalAction = (action: string, value?: unknown) =>
  api("terminal-action", { action, value });
export const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const errorBox = (error: string) =>
  error ? (
    <p className="wb-error" role="alert">
      {error}
    </p>
  ) : null;
export function Header({ children }: React.PropsWithChildren) {
  return <div className="wb-bar">{children}</div>;
}
export const dirtyTabs = new Set<string>();
