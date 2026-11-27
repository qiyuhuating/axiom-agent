import { resolve } from "node:path";
import { launchLogged } from "../log-launch.mjs";
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

export function startDetachedRuntime(root, logPath, env) {
  return launchLogged(process.execPath, [resolve(root, "src/runtime.mjs")], root, logPath, env);
}
