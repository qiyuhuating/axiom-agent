import { randomBytes, randomUUID } from "node:crypto";
import { linkSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.mjs";

export const runtimePort = config.runtimePort;
const path = resolve(config.sessionDir, "runtime.token");
function loadToken() {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // Publish a complete token even if two hosts initialize the directory together.
  const temp = path + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temp, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600, flush: true });
    try {
      linkSync(temp, path);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  } finally {
    rmSync(temp, { force: true });
  }
  return readFileSync(path, "utf8");
}
export const runtimeToken = loadToken();
if (runtimeToken.length !== 64 || /[^a-fA-F0-9]/.test(runtimeToken))
  throw Error("Invalid runtime.token. Stop this instance and repair its session directory.");
export const runtimeUrl = "http://127.0.0.1:" + runtimePort;
