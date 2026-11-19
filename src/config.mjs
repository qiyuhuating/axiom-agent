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
config.workspace = resolve(root, config.workspace);
config.sessionDir = resolve(root, config.sessionDir);
mkdirSync(config.workspace, { recursive: true });
mkdirSync(config.sessionDir, { recursive: true });
