import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
export async function resolveDeliverables(workspace, paths) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 20)
    throw Error("Provide 1 to 20 workspace files");
  const base = await realpath(workspace);
  const result = [];
  for (const path of paths) {
    if (typeof path !== "string" || !path || isAbsolute(path) || path.includes("\0"))
      throw Error("Expected relative workspace file path");
    const candidate = resolve(base, path);
    const inside = (p) => {
      const rel = relative(base, p);
      return rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep);
    };
    if (!inside(candidate)) throw Error("Outside workspace");
    const actual = await realpath(candidate);
    if (!inside(actual)) throw Error("Outside workspace");
    const info = await stat(actual);
    if (!info.isFile() || info.size > 10 * 1024 * 1024)
      throw Error("Not a file or exceeds preview limit");
    const normalized = relative(base, actual).split(sep).join("/");
    if (!result.some((f) => f.path === normalized))
      result.push({ path: normalized, size: info.size });
  }
  return result;
}
