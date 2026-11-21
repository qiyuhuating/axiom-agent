import { isAbsolute, relative, sep } from "node:path";

export function contains(base, path) {
  const rel = relative(base, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep));
}
