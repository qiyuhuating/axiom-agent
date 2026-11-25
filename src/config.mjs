import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Errors } from "typebox/value";
import schema from "./axiom.config.schema.json" with { type: "json" };
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
  schemaVersion: 1,
  port: 4789,
  workspace: "workspace",
  sessionDir: ".sessions",
  ...user,
};
const desktop = process.env.AXIOM_DESKTOP === "1";
if (desktop && config.runtimePort === undefined)
  throw Error("Desktop requires a configured runtime port");
if (config.port === 0 && config.runtimePort === undefined)
  throw Error("An ephemeral host port requires an explicit runtimePort");
config.runtimePort ??= config.port + 1;
config.rustTerminalPort ??= config.runtimePort + 1;
const [error] = Errors(schema, config);
if (error) {
  const key = error.instancePath.slice(1);
  throw Error(schema.properties[key]?.description ?? error.message);
}
if (desktop) config.port = 0;
if (config.runtimePort === config.port) throw Error("Runtime and workbench ports must be distinct");
if ([config.port, config.runtimePort].includes(config.rustTerminalPort))
  throw Error("A distinct rustTerminalPort is required");
// Accept historical backend selections without rewriting the user's configuration.
config.terminalBackend = "rust";
config.importLegacyTerminalHistory ??= true;
config.workspace = resolve(root, config.workspace);
config.sessionDir = resolve(root, config.sessionDir);
mkdirSync(config.workspace, { recursive: true });
mkdirSync(config.sessionDir, { recursive: true, mode: 0o700 });
const realWorkspace = realpathSync.native(config.workspace);
const realSessions = realpathSync.native(config.sessionDir);
// On POSIX Pi records getcwd(), which resolves symlinks such as macOS /var.
// Windows callers also use short paths in the existing runtime identity contract.
if (process.platform !== "win32") {
  config.workspace = realWorkspace;
  config.sessionDir = realSessions;
}
if (contains(realWorkspace, realSessions)) throw Error("sessionDir must be outside the workspace");
