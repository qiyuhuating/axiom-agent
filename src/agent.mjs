import { unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { config, root } from "./config.mjs";
import { projectHarness } from "./harness-state.mjs";
import { decodeRequest, validateAnswer } from "./interaction-protocol.mjs";
import { PiClient } from "./pi-client.mjs";
import { builtinPromptPath } from "./prompt-store.mjs";

export class Agent {
  #client;
  #listeners = new Set();
  #busy = false;
  #startup;
  #sessionId;
  #recovering;
  #closed = false;
  #makeClient;
  constructor(makeClient = (options) => new PiClient(options)) {
    this.#makeClient = makeClient;
  }
  #changing = false;
  #sessionRevision = 0;
  #dialogs = new Map();
  get busy() {
    return this.#busy;
  }
  async start() {
    if (this.#closed) throw Error("Agent is closed");
    if (this.#recovering) await this.#recovering;
    if (this.#closed) throw Error("Agent is closed");
    this.#startup ??= this.#init();
    return this.#startup;
  }
  async #init() {
    const client = this.#makeClient({
      cliPath: resolve(root, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"),
      cwd: config.workspace,
      provider: config.provider,
      model: config.model,
      args: [
        "--session-dir",
        config.sessionDir,
        ...(this.#sessionId ? ["--session-id", this.#sessionId] : ["--continue"]),
        ...(!config.discoverContext ? ["--no-context-files"] : []),
        ...(config.maxOutputTokens ? ["--extension", resolve(root, "src/output-budget.ts")] : []),
        "--extension",
        resolve(root, "src/approval.ts"),
        "--extension",
        resolve(root, "src/providers.ts"),
        "--extension",
        resolve(root, "src/builtin-prompt.ts"),
        "--extension",
        resolve(root, "src/deliverables.ts"),
        "--extension",
        resolve(root, "src/interactions.ts"),
        "--extension",
        resolve(root, "src/goal.ts"),
        "--extension",
        resolve(root, "src/file-observation.ts"),
      ],
      env: {
        AXIOM_MAX_OUTPUT_TOKENS: String(config.maxOutputTokens ?? ""),
        AXIOM_PROVIDER_FILE: resolve(config.sessionDir, "axiom-providers.json"),
        AXIOM_PERMISSION_FILE: resolve(config.sessionDir, "permission.json"),
        AXIOM_BUILTIN_PROMPT_FILE: builtinPromptPath,
      },
    });
    this.#client = client;
    client.onDisconnect = (error) => this.#retire(client, error);
    client.onEvent((event) => {
      if (this.#client !== client) return;
      if (
        event.type === "extension_ui_request" &&
        ["select", "confirm", "input", "editor"].includes(event.method)
      ) {
        this.#dialogs.set(event.id, event);
        if (event.timeout)
          setTimeout(() => {
            if (this.#client === client && this.#dialogs.delete(event.id))
              this.#emit({ type: "ui_closed", id: event.id });
          }, event.timeout).unref();
      }
      if (event.type === "agent_settled") {
        for (const id of this.#dialogs.keys()) this.#emit({ type: "ui_closed", id });
        this.#dialogs.clear();
      }
      if (event.type === "agent_start") this.#busy = true;
      if (event.type === "agent_settled") this.#busy = false;
      this.#emit({ ...event, busy: this.#busy });
    });
    try {
      await client.start();
      await this.#rememberSession(client);
    } catch (error) {
      this.#retire(client, error);
      throw error;
    }
  }
  async #rememberSession(client) {
    const state = await client.getState();
    if (this.#client === client) this.#sessionId = state.sessionId;
    return state;
  }
  async #sessionChange(client, operation) {
    const result = await operation;
    await this.#rememberSession(client);
    return result;
  }
  #retire(client, error) {
    if (this.#client !== client) return;
    this.#client = undefined;
    this.#startup = undefined;
    this.#busy = false;
    this.#recovering = client
      .stop()
      .catch((e) => console.error("Pi cleanup:", e.message))
      .finally(() => {
        this.#recovering = undefined;
      });
    for (const id of this.#dialogs.keys()) this.#emit({ type: "ui_closed", id });
    this.#dialogs.clear();
    if (!this.#closed) this.#emit({ type: "connection_error", error: error.message, busy: false });
  }
  #emit(event) {
    for (const listener of this.#listeners) listener(event);
  }
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  async state() {
    await this.start();
    return this.#projectState(await this.#rememberSession(this.#client));
  }
  #projectState(state) {
    return {
      model: state.model && {
        provider: state.model.provider,
        id: state.model.id,
      },
      thinkingLevel: state.thinkingLevel,
      busy: this.#busy,
      sessionId: state.sessionId,
      workspace: config.workspace,
    };
  }
  async snapshot() {
    await this.start();
    const client = this.#client;
    const revision = this.#sessionRevision;
    if (revision % 2) throw Error("Session change in progress");
    const [state, messages, tree, sessions] = await Promise.all([
      client.getState(),
      client.getMessages(),
      client.getTree(),
      this.sessions(),
    ]);
    if (client !== this.#client || revision !== this.#sessionRevision)
      throw Error("Session changed while reading its snapshot");
    this.#sessionId = state.sessionId;
    return {
      state: this.#projectState(state),
      messages: messages.filter((m) => m.role !== "system"),
      sessions,
      dialogs: this.pendingDialogs(),
      harness: { sessionId: state.sessionId, ...projectHarness(tree) },
    };
  }
  async harnessState() {
    await this.start();
    const client = this.#client;
    const state = await client.getState();
    const tree = await client.getTree();
    if (client !== this.#client || state.sessionId !== (await client.getState()).sessionId)
      throw Error("Session changed while reading Harness state");
    return { sessionId: state.sessionId, ...projectHarness(tree) };
  }
  async messages() {
    await this.start();
    return (await this.#client.getMessages()).filter((m) => m.role !== "system");
  }
  async models() {
    await this.start();
    return this.#client.getAvailableModels();
  }
  async levels() {
    await this.start();
    return this.#client.getAvailableThinkingLevels();
  }
  async sessions() {
    const list = await SessionManager.list(config.workspace, config.sessionDir);
    return list.map(({ id, name, firstMessage, modified }) => ({
      id,
      name,
      firstMessage,
      modified,
    }));
  }
  async prompt(message, images) {
    await this.start();
    if (this.#busy || this.#changing) throw new Error("Agent is running or changing session.");
    this.#busy = true;
    this.#emit({ type: "run_status", busy: true });
    try {
      const disposition = await this.#client.prompt(message, images);
      if (disposition === "handled") {
        this.#busy = false;
        this.#emit({ type: "run_status", busy: false });
      }
      return { disposition };
    } catch (error) {
      this.#busy = false;
      this.#emit({ type: "run_status", busy: false });
      throw error;
    }
  }
  async steer(message, images) {
    await this.start();
    if (this.#changing) throw new Error("Session change in progress.");
    return this.#client.steer(message, images);
  }
  async followUp(message, images) {
    await this.start();
    if (this.#changing) throw Error("Session change in progress");
    return this.#client.followUp(message, images);
  }
  async clearQueue() {
    await this.start();
    return this.#client.clearQueue();
  }
  async sessionDetails(view) {
    await this.start();
    if (view === "stats") return { stats: await this.#client.getSessionStats() };
    if (view === "forks") return { forks: await this.#client.getForkMessages() };
    const [stats, forks, tree] = await Promise.all([
      this.#client.getSessionStats(),
      this.#client.getForkMessages(),
      this.#client.getTree(),
    ]);
    return { stats, forks, tree };
  }
  async abort() {
    await this.start();
    if (this.#changing) throw new Error("Session change in progress.");
    await this.#client.abort();
    this.#busy = false;
    this.#emit({ type: "run_status", busy: false });
  }
  async exclusiveResourceChange(operation) {
    if (this.#busy || this.#changing) throw Error("Stop the agent before changing resources");
    this.#changing = true;
    try {
      return await operation();
    } finally {
      this.#changing = false;
      this.#emit({ type: "state_changed", busy: this.#busy });
    }
  }
  async change(action, value) {
    await this.start();
    if (this.#busy || this.#changing)
      throw new Error("Stop current run or wait for the session change.");
    this.#changing = true;
    this.#sessionRevision++;
    try {
      if (action === "new")
        return await this.#sessionChange(this.#client, this.#client.newSession());
      if (action === "switch" || action === "delete") {
        const list = await SessionManager.list(config.workspace, config.sessionDir);
        const entry = list.find((s) => s.id === value);
        if (!entry) throw new Error("Session not found or already deleted.");
        if (action === "switch")
          return await this.#sessionChange(this.#client, this.#client.switchSession(entry.path));
        const path = resolve(entry.path);
        if (dirname(path) !== resolve(config.sessionDir) || !path.endsWith(".jsonl"))
          throw new Error("Invalid session path.");
        const state = await this.#client.getState();
        if (state.sessionId === entry.id) {
          const result = await this.#sessionChange(this.#client, this.#client.newSession());
          if (result.cancelled || (await this.#client.getState()).sessionId === entry.id) {
            throw new Error("Pi refused to close the active session.");
          }
        }
        await unlink(path);
        return { deleted: entry.id };
      }
      if (action === "rename") {
        if (typeof value !== "string" || !value.trim() || value.length > 200)
          throw Error("Invalid session name");
        await this.#client.setSessionName(value.trim());
        return { ok: true };
      }
      if (action === "clone") return await this.#sessionChange(this.#client, this.#client.clone());
      if (action === "fork") {
        if (!(await this.#client.getForkMessages()).some((m) => m.entryId === value))
          throw Error("Unknown fork entry");
        return await this.#sessionChange(this.#client, this.#client.fork(value));
      }
      if (action === "compact")
        return this.#client.compact(typeof value === "string" ? value : undefined);
      if (action === "auto-compaction" || action === "auto-retry") {
        if (typeof value !== "boolean") throw Error("Boolean required");
        await (action === "auto-compaction"
          ? this.#client.setAutoCompaction(value)
          : this.#client.setAutoRetry(value));
        return { ok: true };
      }
      if (action === "steering-mode" || action === "follow-up-mode") {
        if (!["all", "one-at-a-time"].includes(value)) throw Error("Invalid queue mode");
        await (action === "steering-mode"
          ? this.#client.setSteeringMode(value)
          : this.#client.setFollowUpMode(value));
        return { ok: true };
      }
      if (action === "model") return await this.#client.setModel(value.provider, value.id);
      if (action === "thinking") return await this.#client.setThinkingLevel(value);
      throw new Error("Unknown action");
    } finally {
      this.#sessionRevision++;
      this.#changing = false;
      if (
        [
          "new",
          "switch",
          "delete",
          "model",
          "thinking",
          "rename",
          "clone",
          "fork",
          "compact",
          "auto-compaction",
          "auto-retry",
          "steering-mode",
          "follow-up-mode",
        ].includes(action)
      )
        this.#emit({ type: "state_changed", busy: this.#busy });
    }
  }
  async commands() {
    await this.start();
    return this.#client.getCommands();
  }
  pendingDialogs() {
    return [...this.#dialogs.values()];
  }
  async respond({ id, value, confirmed, cancelled }) {
    const dialog = this.#dialogs.get(id);
    if (!dialog) throw Error("Interaction expired or already answered");
    if (!cancelled) {
      const request = decodeRequest(dialog);
      if (request) validateAnswer(request, value);
      if (dialog.method === "confirm" && typeof confirmed !== "boolean")
        throw Error("Confirmation required");
      if (dialog.method === "select" && !dialog.options?.includes(value))
        throw Error("Invalid selection");
      if (["input", "editor"].includes(dialog.method) && typeof value !== "string")
        throw Error("Text required");
    }
    const client = this.#client;
    this.#dialogs.delete(id);
    try {
      await client.respond({
        type: "extension_ui_response",
        id,
        ...(cancelled
          ? { cancelled: true }
          : dialog.method === "confirm"
            ? { confirmed }
            : { value }),
      });
    } catch (error) {
      if (this.#client === client && !client.disconnected) this.#dialogs.set(id, dialog);
      throw error;
    }
    this.#emit({ type: "ui_closed", id });
    return { ok: true };
  }
  async close() {
    this.#closed = true;
    const client = this.#client;
    if (client) {
      this.#retire(client, Error("Agent closed"));
    }
    await this.#recovering;
  }
}
