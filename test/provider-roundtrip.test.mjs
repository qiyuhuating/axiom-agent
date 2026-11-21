import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("Pi completes a streamed provider turn with a real read tool and persists the result", {
  timeout: 40000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "axiom-roundtrip-"));
  const workspace = join(dir, "workspace"),
    sessionDir = join(dir, "sessions");
  await mkdir(workspace);
  await mkdir(sessionDir);
  await writeFile(join(workspace, "fixture.txt"), "AXIOM_LOCAL_FIXTURE");
  const requests = [];
  const model = "fixture-model";
  const provider = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const { messages } = JSON.parse(body);
    requests.push({ path: req.url, messages });
    const first = requests.length === 1;
    const chunk = (delta, finish_reason = null) =>
      "data: " +
      JSON.stringify({
        id: "fixture-chat",
        object: "chat.completion.chunk",
        created: 1,
        model,
        choices: [{ index: 0, delta, finish_reason }],
      }) +
      "\n\n";
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(
      chunk(
        first
          ? {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "call_read",
                  type: "function",
                  function: { name: "read", arguments: JSON.stringify({ path: "fixture.txt" }) },
                },
              ],
            }
          : { role: "assistant", content: "The local read completed." },
      ) +
        chunk({}, first ? "tool_calls" : "stop") +
        "data: [DONE]\n\n",
    );
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  process.env.PI_CODING_AGENT_DIR = join(dir, "pi-profile");
  process.env.AXIOM_CONFIG = join(dir, "config.json");
  const name = "axiom-custom-fixture";
  await writeFile(
    process.env.AXIOM_CONFIG,
    JSON.stringify({ workspace, sessionDir, provider: name, model, discoverContext: false }),
  );
  await writeFile(
    join(sessionDir, "axiom-providers.json"),
    JSON.stringify([
      {
        name,
        baseUrl: "http://127.0.0.1:" + provider.address().port + "/v1",
        api: "openai-completions",
        modelId: model,
        contextWindow: 32768,
        maxTokens: 1024,
        reasoning: false,
        image: false,
      },
    ]),
  );
  const { Agent } = await import("../src/agent.mjs");
  const agent = new Agent();
  t.after(async () => {
    await agent.close();
    await new Promise((done) => provider.close(done));
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  const settled = Promise.withResolvers();
  const unsubscribe = agent.subscribe((event) => {
    if (event.type === "agent_settled") settled.resolve();
  });
  t.after(unsubscribe);
  await agent.prompt("Read fixture.txt and confirm.");
  await settled.promise;
  const messages = await agent.messages();
  assert.equal(
    requests.length,
    2,
    JSON.stringify(messages.map((m) => ({ role: m.role, error: m.errorMessage }))),
  );
  assert.ok(requests.every((r) => r.path === "/v1/chat/completions"));
  assert.ok(
    requests[1].messages.some(
      (m) => m.role === "tool" && JSON.stringify(m.content).includes("AXIOM_LOCAL_FIXTURE"),
    ),
  );
  assert.equal(messages.at(-1).content[0].text, "The local read completed.");
  const state = await agent.state();
  assert.equal(state.busy, false);
  assert.ok((await agent.sessions()).some((s) => s.id === state.sessionId));
});
