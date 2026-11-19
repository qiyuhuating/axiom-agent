import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { resolve } from "node:path";
import { windows } from "./windows.mjs";

const unsupportedSandbox = () => {
  throw Error("OS write sandbox is not configured for " + process.platform);
};
const posix = {
  terminalShell(env = process.env) {
    return env.AXIOM_PWSH_EXE || "pwsh";
  },
  sandboxEntry: unsupportedSandbox,
  sandboxWorker: unsupportedSandbox,
};
// POSIX intentionally fails closed for background agents until a real
// system sandbox is implemented and verified. Never run unsandboxed.
export const platform = process.platform === "win32" ? windows : posix;

export function startDetachedRuntime(root, logPath) {
  const fd = openSync(logPath, "a");
  try {
    const child = spawn(process.execPath, [resolve(root, "src/runtime.mjs")], {
      cwd: root,
      env: process.env,
      detached: true,
      ...(process.platform === "win32" ? { windowsHide: true } : {}),
      stdio: ["ignore", fd, fd],
    });
    child.on("error", (e) => console.error("Runtime launch:", e.message));
    child.unref();
    return child;
  } finally {
    closeSync(fd);
  }
}
