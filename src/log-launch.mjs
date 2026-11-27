import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
export function launchLogged(binary, args, cwd, path, env = process.env) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./log-relay.mjs", import.meta.url)), path, binary, ...args],
    { cwd, env, detached: true, windowsHide: true, stdio: "ignore" },
  );
  child.on("error", (e) => console.error("Runtime launch:", e.message));
  child.unref();
  return child;
}
