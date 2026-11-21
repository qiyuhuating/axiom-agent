import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { contains } from "./path-boundary.mjs";
export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const path = resolve(root, process.env.AXIOM_CONFIG ?? "axiom.config.json");
const user =
  process.env.AXIOM_CONFIG !== undefined || existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""))
    : {};
if (!user || typeof user !== "object" || Array.isArray(user))
  throw Error("Expected a JSON configuration object");
export const config = {
  port: 4789,
  workspace: "workspace",
  sessionDir: ".sessions",
  ...user,
};
function port(name, value, min) {
  if (!Number.isInteger(value) || value < min || value > 65535)
    throw Error(name + " must be an integer between " + min + " and 65535");
}
port("port", config.port, 0);
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
if (config.port === 0 && config.runtimePort === undefined)
  throw Error("An ephemeral host port requires an explicit runtimePort");
config.runtimePort ??= config.port + 1;
port("runtimePort", config.runtimePort, 1);
if (config.runtimePort === config.port) throw Error("Runtime and workbench ports must be distinct");
if (config.terminalBackend === "rust") {
  port("rustTerminalPort", config.rustTerminalPort, 1024);
  if ([config.port, config.runtimePort].includes(config.rustTerminalPort))
    throw Error("A distinct rustTerminalPort is required");
}
for (const key of ["workspace", "sessionDir"]) {
  if (typeof config[key] !== "string" || !config[key].trim())
    throw Error(key + " must be a nonempty path");
}
for (const key of ["discoverContext", "importLegacyTerminalHistory", "nativeGateway"]) {
  if (config[key] !== undefined && typeof config[key] !== "boolean")
    throw Error(key + " must be a boolean");
}
if (
  config.maxOutputTokens !== undefined &&
  (!Number.isSafeInteger(config.maxOutputTokens) || config.maxOutputTokens < 1)
)
  throw Error("maxOutputTokens must be a positive integer");
config.workspace = resolve(root, config.workspace);
config.sessionDir = resolve(root, config.sessionDir);
mkdirSync(config.workspace, { recursive: true });
mkdirSync(config.sessionDir, { recursive: true, mode: 0o700 });
if (contains(realpathSync(config.workspace), realpathSync(config.sessionDir)))
  throw Error("sessionDir must be outside the workspace");
