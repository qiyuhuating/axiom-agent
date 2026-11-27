import { buildSessionContext } from "@earendil-works/pi-coding-agent";
import { projectHarnessEntries } from "./harness-state.mjs";

// One active session per Pi client. Use upstream append cursors and its own
// branch/compaction/context-edit projection, not an independent JSONL parser.
export class SessionEntryIndex {
  #client;
  #sessionId;
  #entries = [];
  #byId = new Map();
  #tail;
  #projection;
  #pending = Promise.resolve();
  read(client, sessionId) {
    const next = this.#pending.then(() => this.#read(client, sessionId));
    this.#pending = next.catch(() => {});
    return next;
  }
  async #read(client, sessionId) {
    const same = this.#client === client && this.#sessionId === sessionId;
    const since = same ? this.#tail : undefined;
    let page;
    let reset = !since;
    try {
      page = await client.getEntries(since);
    } catch (error) {
      // The upstream explicitly rejects a cursor removed by a rewritten session.
      if (!since || !String(error.message).includes("Entry not found: " + since)) throw error;
      page = await client.getEntries();
      reset = true;
    }
    if (reset) {
      this.#client = client;
      this.#sessionId = sessionId;
      this.#entries = [];
      this.#byId = new Map();
      this.#tail = undefined;
      this.#projection = undefined;
    }
    for (const entry of page.entries) {
      if (this.#byId.has(entry.id)) throw Error("Duplicate Pi session entry");
      this.#entries.push(entry);
      this.#byId.set(entry.id, entry);
      this.#tail = entry.id;
    }
    if (page.leafId !== null && !this.#byId.has(page.leafId))
      throw Error("Unknown Pi session leaf");
    if (!page.entries.length && this.#projection?.leafId === page.leafId) return this.#projection;
    this.#projection = {
      entries: this.#entries,
      leafId: page.leafId,
      messages: buildSessionContext(this.#entries, page.leafId, this.#byId).messages,
      harness: projectHarnessEntries(this.#byId, page.leafId),
    };
    return this.#projection;
  }
}
