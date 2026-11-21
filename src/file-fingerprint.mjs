import { createHash } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const MAX = 10 * 1024 * 1024;
function within(base, path) {
  const rel = relative(base, path);
  return rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep);
}
export async function fileFingerprint(workspace, path, captureText = false) {
  if (typeof path !== "string" || !path) return null;
  try {
    const base = await realpath(workspace),
      candidate = resolve(base, path);
    if (!within(base, candidate)) return null;
    let actual;
    try {
      actual = await realpath(candidate);
    } catch (e) {
      if (e.code !== "ENOENT") return null;
      let ancestor = dirname(candidate);
      while (true) {
        try {
          const parent = await realpath(ancestor);
          if (parent !== base && !within(base, parent)) return null;
          break;
        } catch (error) {
          if (error.code !== "ENOENT") return null;
          const next = dirname(ancestor);
          if (next === ancestor) return null;
          ancestor = next;
        }
      }
      return {
        path: relative(base, candidate).split(sep).join("/"),
        sha256: null,
        ...(captureText ? { text: "" } : {}),
      };
    }
    if (!within(base, actual)) return null;
    const info = await stat(actual);
    if (!info.isFile() || info.size > MAX) return null;
    const fd = await open(actual, "r");
    let data;
    try {
      const buffer = Buffer.allocUnsafe(info.size + 1);
      const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
      if (bytesRead !== info.size) return null;
      data = buffer.subarray(0, bytesRead);
    } finally {
      await fd.close();
    }
    return {
      path: relative(base, actual).split(sep).join("/"),
      sha256: createHash("sha256").update(data).digest("hex"),
      ...(captureText &&
      data.length <= 65536 &&
      !data.includes(0) &&
      Buffer.from(data.toString("utf8")).equals(data)
        ? { text: data.toString("utf8") }
        : {}),
    };
  } catch {
    return null;
  }
}
