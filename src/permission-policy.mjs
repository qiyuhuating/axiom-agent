import { readFileSync } from "node:fs";

export const permissionModes = ["ask", "read-only", "full"];

export function readPermission(path, defaultMode) {
  try {
    const mode = JSON.parse(readFileSync(path, "utf8"))?.mode;
    if (!permissionModes.includes(mode))
      throw Object.assign(Error("Invalid stored permission mode"), {
        code: "INVALID_PERMISSION_POLICY",
      });
    return mode;
  } catch (error) {
    if (error.code === "ENOENT") return defaultMode;
    throw error;
  }
}
