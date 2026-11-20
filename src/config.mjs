import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const path = resolve(root, process.env.AXIOM_CONFIG ?? "axiom.config.json");
const user = existsSync(path) ? JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) : {};
export const config = {
  port: 4789,
  workspace: "workspace",
  sessionDir: ".sessions",
  ...user,
};
if (process.env.AXIOM_DESKTOP === "1") {
  if (!config.runtimePort) throw Error("Desktop requires a configured runtime port");
  config.port = 0;
}
if (config.terminalBackend !== undefined && !["node", "rust"].includes(config.terminalBackend))
  throw Error("Invalid terminalBackend");
// Installed Windows builds contain the Rust daemon but not the reference
// Node terminal implementation. Keep the original configuration intact for rollback.
const packaged = process.platform === "win32" && existsSync(resolve(root, "bin/axiom-daemon.exe"));
if (packaged) {
  config.terminalBackend = "rust";
  config.rustTerminalPort ??= (config.runtimePort ?? config.port + 1) + 1;
  config.importLegacyTerminalHistory ??= true;
} else {
  config.terminalBackend ??= "node";
}
config.workspace = resolve(root, config.workspace);
config.sessionDir = resolve(root, config.sessionDir);
mkdirSync(config.workspace, { recursive: true });
mkdirSync(config.sessionDir, { recursive: true });
