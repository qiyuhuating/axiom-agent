import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.mjs";
export const runtimePort = config.runtimePort ?? config.port + 1;
const path = resolve(config.sessionDir, "runtime.token");
try {
  writeFileSync(path, randomBytes(32).toString("hex"), {
    flag: "wx",
    mode: 0o600,
  });
} catch (e) {
  if (e.code !== "EEXIST") throw e;
}
export const runtimeToken = readFileSync(path, "utf8");
export const runtimeUrl = "http://127.0.0.1:" + runtimePort;
