import { setTimeout as delay } from "node:timers/promises";
import { MessageChannel, receiveMessageOnPort, Worker } from "node:worker_threads";

// Only the legacy Cordis API uses synchronous RPC. The HTTP gateway uses the
// asynchronous backend directly. A timed-out write is never retried.
export function createCordisTerminalAdapter(base, token) {
  let worker;
  let closed = false;
  const records = new Map();
  const headers = { Authorization: "Bearer " + token };
  function request(path, body) {
    if (closed) throw Error("Terminal adapter closed");
    if (!worker) {
      worker = new Worker(new URL("./terminal-cordis-worker.mjs", import.meta.url), {
        workerData: { base, token },
      });
      worker.unref();
      const activeWorker = worker;
      worker.on("error", (error) => console.error("Terminal plugin worker:", error.message));
      worker.on("exit", () => {
        if (worker === activeWorker) worker = undefined;
      });
    }
    const { port1, port2 } = new MessageChannel();
    const signal = new SharedArrayBuffer(4);
    const state = new Int32Array(signal);
    try {
      worker.postMessage({ path, body, signal, reply: port2 }, [port2]);
      if (Atomics.wait(state, 0, 0, 10000) === "timed-out")
        throw Error("Terminal plugin request timed out");
      const result = receiveMessageOnPort(port1)?.message;
      if (!result) throw Error("Terminal plugin response unavailable");
      if (result.error) throw Error(result.error);
      return result.data;
    } finally {
      port1.close();
    }
  }
  function notify(record, event) {
    for (const fn of record.listeners) {
      try {
        fn(event);
      } catch (error) {
        console.error("Terminal plugin listener:", error.message);
      }
    }
  }
  function apply(record, event) {
    if (event.snapshot) {
      const before = record.buffer;
      record.buffer = event.data || "";
      record.exit = event.exit;
      record.interrupted = Boolean(event.interrupted);
      if (record.buffer.startsWith(before)) {
        const data = record.buffer.slice(before.length);
        if (data) notify(record, { data });
      } else if (before !== record.buffer) notify(record, event);
    } else if (event.data) {
      record.buffer = (record.buffer + event.data).slice(-262144);
      notify(record, { data: event.data });
    }
    if (typeof event.exit === "number") {
      record.exit = event.exit;
      record.pty = null;
      notify(record, { exit: event.exit });
    }
    if (event.interrupted) record.pty = null;
    if (event.closed) {
      record.pty = null;
      records.delete(record.id);
      notify(record, { closed: true });
      record.controller.abort();
    }
  }
  async function subscribe(record) {
    const signal = record.controller.signal;
    while (!signal.aborted) {
      try {
        const response = await fetch(
          base + "/api/terminal/events?id=" + encodeURIComponent(record.id),
          { headers, signal },
        );
        if (response.status === 400) {
          apply(record, { closed: true });
          return;
        }
        if (!response.ok) throw Error("Terminal event stream unavailable");
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
              const frame = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              const line = frame.split("\n").find((line) => line.startsWith("data: "));
              if (line && !signal.aborted) apply(record, JSON.parse(line.slice(6)));
            }
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } catch (error) {
        if (!signal.aborted) console.error("Terminal plugin stream:", error.message);
      }
      if (!signal.aborted) await delay(250, undefined, { signal }).catch(() => {});
    }
  }
  function action(action, value) {
    const result = request("/api/terminal-action", { action, value });
    if (action === "close") {
      const record = records.get(value.id);
      if (record) apply(record, { closed: true });
    }
    return result;
  }
  function get(id) {
    let record = records.get(id);
    if (!record) {
      const snapshot = request("/api/terminal-snapshot?id=" + encodeURIComponent(id));
      record = { ...snapshot, listeners: new Set(), controller: new AbortController(), pty: null };
      if (record.exit === null && !record.interrupted) {
        record.pty = {
          write: (data) => action("input", { id, data }),
          resize: (cols, rows) => action("resize", { id, cols, rows }),
          kill: () => action("terminate", { id }),
          onData(fn) {
            const listener = (e) => {
              if (e.data && !e.snapshot) fn(e.data);
            };
            record.listeners.add(listener);
            return { dispose: () => record.listeners.delete(listener) };
          },
          onExit(fn) {
            const listener = (e) => {
              if (typeof e.exit === "number") fn({ exitCode: e.exit });
            };
            record.listeners.add(listener);
            return { dispose: () => record.listeners.delete(listener) };
          },
        };
      }
      records.set(id, record);
      void subscribe(record);
    }
    return record;
  }
  return {
    list: () => request("/api/terminals"),
    get,
    action,
    async close() {
      closed = true;
      for (const record of records.values()) record.controller.abort();
      records.clear();
      if (worker) await worker.terminate();
    },
  };
}
