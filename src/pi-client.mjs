import { RpcClient } from "@earendil-works/pi-coding-agent";

// The pinned upstream RpcClient has a one-way UI gap and no lifecycle
// subscription. Keep the compatibility seam here; never replay a request.
export class PiClient extends RpcClient {
  disconnected = false;
  onDisconnect;
  #stopping = false;
  #timeoutMs;
  #stepWaiters = new Set();
  constructor(options = {}, timeoutMs = 30000) {
    super(options);
    this.#timeoutMs = timeoutMs;
  }
  async start() {
    const startup = super.start();
    const child = this.process;
    child?.once("exit", () => this.#lost(this.exitError ?? Error("Pi process exited")));
    child?.once("error", (error) => this.#lost(error));
    child?.stdin?.on("error", (error) => this.#lost(error));
    try {
      await startup;
    } catch (error) {
      this.#lost(error);
      throw error;
    }
  }
  #lost(error) {
    if (this.disconnected || this.#stopping) return;
    this.disconnected = true;
    this.exitError = error;
    this.rejectPendingRequests(error);
    for (const reject of this.#stepWaiters) reject(error);
    this.onDisconnect?.(error);
  }
  async send(command) {
    if (this.disconnected) throw this.exitError;
    let timer;
    try {
      return await Promise.race([
        super.send(command),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error("Timeout waiting for response to " + command.type)),
            this.#timeoutMs,
          );
        }),
      ]);
    } catch (error) {
      if (this.exitError || /^Timeout waiting for response to /.test(error.message)) {
        this.#lost(error);
        this.process?.kill();
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  async stop() {
    this.#stopping = true;
    this.rejectPendingRequests(Error("Pi RPC stopped"));
    for (const reject of this.#stepWaiters) reject(Error("Pi RPC stopped"));
    if (this.process?.exitCode !== null || this.process?.signalCode) {
      this.stopReadingStdout?.();
      this.process = null;
      return;
    }
    await super.stop();
  }
  async runStep(message, timeout = 30 * 60 * 1000) {
    if (this.disconnected) throw this.exitError;
    let off, timer, fail, last;
    const settled = new Promise((resolve, reject) => {
      fail = reject;
      this.#stepWaiters.add(reject);
      timer = setTimeout(() => reject(Error("Workflow step timed out")), timeout);
      off = this.onEvent((event) => {
        if (event.type === "message_end" && event.message?.role === "assistant")
          last = event.message;
        if (event.type === "agent_settled") {
          if (event.aborted) reject(Error("Workflow aborted"));
          else if (!last || ["error", "aborted"].includes(last.stopReason))
            reject(Error(last?.errorMessage || "No completed assistant response"));
          else resolve(last);
        }
      });
    });
    settled.catch(() => {});
    try {
      const disposition = await this.prompt(message);
      if (disposition === "handled") throw Error("Workflow steps must be model prompts");
      return await settled;
    } finally {
      clearTimeout(timer);
      off();
      this.#stepWaiters.delete(fail);
    }
  }
  async respond(record) {
    const stdin = this.process?.stdin;
    if (this.disconnected || !stdin?.writable) throw Error("Pi RPC stdin unavailable");
    try {
      await new Promise((resolve, reject) =>
        stdin.write(JSON.stringify(record) + "\n", (error) => (error ? reject(error) : resolve())),
      );
    } catch (error) {
      this.#lost(error);
      throw error;
    }
  }
}
