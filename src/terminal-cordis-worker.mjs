import { parentPort, workerData } from "node:worker_threads";

const { base, token } = workerData;
parentPort.on("message", async ({ path, body, signal, reply }) => {
  const state = new Int32Array(signal);
  try {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + token,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Terminal request failed");
    reply.postMessage({ data });
  } catch (error) {
    reply.postMessage({ error: error.message });
  } finally {
    Atomics.store(state, 0, 1);
    Atomics.notify(state, 0);
    reply.close();
  }
});
