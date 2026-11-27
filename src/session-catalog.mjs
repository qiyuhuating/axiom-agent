import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

function signature(stats) {
  return [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].join(":");
}
// Match only the subset of native SessionManager.list used by the sidebar.
// Do not retain allMessagesText or read any model-facing history from here.
async function summarize(path, stats) {
  let header,
    name,
    firstMessage = "",
    lastActivityTime;
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (!entry) continue;
      if (!header) {
        if (entry.type !== "session") return null;
        header = entry;
        continue;
      }
      if (entry.type === "session_info") name = entry.name?.trim() || undefined;
      if (entry.type !== "message") continue;
      const message = entry.message;
      if (
        typeof message.role !== "string" ||
        !("content" in message) ||
        (message.role !== "user" && message.role !== "assistant")
      )
        continue;
      const time =
        typeof message.timestamp === "number"
          ? message.timestamp
          : new Date(entry.timestamp).getTime();
      if (!Number.isNaN(time)) lastActivityTime = Math.max(lastActivityTime ?? 0, time);
      if (!firstMessage && message.role === "user") {
        firstMessage =
          typeof message.content === "string"
            ? message.content
            : message.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join(" ");
      }
    }
    if (!header) return null;
    const headerTime =
      typeof header.timestamp === "string" ? new Date(header.timestamp).getTime() : NaN;
    return {
      id: header.id,
      name,
      firstMessage: firstMessage || "(no messages)",
      modified: new Date(
        lastActivityTime > 0
          ? lastActivityTime
          : Number.isNaN(headerTime)
            ? Number(stats.mtimeMs)
            : headerTime,
      ),
    };
  } finally {
    lines.close();
    input.destroy();
  }
}
export class SessionCatalog {
  #cache = new Map();
  #pending;
  constructor(directory) {
    this.directory = directory;
  }
  list() {
    this.#pending ??= this.#list().finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }
  async #list() {
    let files;
    try {
      files = (await readdir(this.directory))
        .filter((file) => file.endsWith(".jsonl"))
        .sort((a, b) => b.localeCompare(a));
    } catch (error) {
      if (error.code === "ENOENT") {
        this.#cache.clear();
        return [];
      }
      throw error;
    }
    const next = new Map();
    const results = new Array(files.length);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(files.length, 8) }, async () => {
        while (cursor < files.length) {
          const index = cursor++;
          const file = files[index],
            path = join(this.directory, file);
          try {
            const before = await stat(path, { bigint: true });
            const key = signature(before);
            let cached = this.#cache.get(file);
            if (cached?.key !== key) {
              const value = await summarize(path, before);
              const after = await stat(path, { bigint: true });
              // A concurrent append or replacement cannot poison the cache.
              cached = { key: signature(after) === key ? key : null, value };
            }
            if (cached.key !== null) next.set(file, cached);
            if (cached.value) results[index] = cached.value;
          } catch (error) {
            if (error.code !== "ENOENT") console.error("Session catalog:", error.message);
          }
        }
      }),
    );
    this.#cache = next;
    return results.filter(Boolean).sort((a, b) => b.modified.getTime() - a.modified.getTime());
  }
}
