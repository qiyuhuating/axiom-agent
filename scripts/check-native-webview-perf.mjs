import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { historyPage, historyTools } from "../src/history-page.mjs";

const [port, baseUrl] = process.argv.slice(2);
assert.match(port ?? "", /^\d+$/);
assert.match(baseUrl ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
assert.ok(process.env.AXIOM_TEST_PLAYWRIGHT_MODULE, "Set AXIOM_TEST_PLAYWRIGHT_MODULE");
const { chromium } = await import(pathToFileURL(process.env.AXIOM_TEST_PLAYWRIGHT_MODULE).href);
const browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
const page = browser.contexts().flatMap(context => context.pages()).find(page => page.url() === baseUrl + "/");
assert.ok(page, "Expected the isolated Axiom WebView2 target");
const session = await page.context().newCDPSession(page);
const records = 2000;
const messages = Array.from({ length: records }, (_, index) => ({
  role: index % 2 ? "assistant" : "user",
  content: [{ type: "text", text: "Native frame fixture " + index + "\n" + "A representative history line.\n".repeat(5) }],
}));
const fixture = "**/api/snapshot*";
try {
  await page.route(fixture, async route => {
    const response = await route.fetch();
    const snapshot = await response.json();
    await route.fulfill({ response, json: { ...snapshot, ...historyPage(messages, snapshot.state.sessionId), historyTools: historyTools(messages) } });
  });
  await page.reload();
  await page.getByText("Native frame fixture 1999", { exact: false }).waitFor();
  await page.bringToFront();
  assert.equal(await page.locator("#transcript [data-history-index]").count(), 80);
  const gpu = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return { webgl: false };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const result = { webgl: true, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return result;
  });
  let systemInfo;
  try {
    const browserSession = await browser.newBrowserCDPSession();
    const info = await browserSession.send("SystemInfo.getInfo");
    systemInfo = { devices: info.gpu.devices.map(({ vendorString, deviceString }) => ({ vendorString, deviceString })), featureStatus: info.gpu.featureStatus };
    await browserSession.detach();
  } catch (error) {
    systemInfo = { unavailable: String(error.message).slice(0, 200) };
  }
  await session.send("Performance.enable");
  const metrics = async () => Object.fromEntries((await session.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
  const before = await metrics();
  const sample = await page.evaluate(async () => {
    const el = document.querySelector("#transcript");
    el.scrollTop = 0;
    const intervals = [];
    let previous;
    const deadline = performance.now() + 15000;
    while (intervals.length < 120) {
      const now = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error("WebView2 frame sample timed out")), Math.max(1, deadline - performance.now()));
        requestAnimationFrame(time => { clearTimeout(timeout); resolve(time); });
      });
      if (previous !== undefined) intervals.push(now - previous);
      previous = now;
      el.scrollTop = (el.scrollTop + 64) % Math.max(1, el.scrollHeight - el.clientHeight);
    }
    intervals.sort((a, b) => a - b);
    return {
      samples: intervals.length,
      medianMs: intervals[Math.floor(intervals.length / 2)],
      p95Ms: intervals[Math.ceil(intervals.length * .95) - 1],
      maxMs: intervals.at(-1),
      width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      visibility: document.visibilityState,
    };
  });
  const after = await metrics();
  const deltaMs = Object.fromEntries(["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration"]
    .filter(key => typeof before[key] === "number" && typeof after[key] === "number")
    .map(key => [key, Math.round((after[key] - before[key]) * 1000 * 100) / 100]));
  console.log("PI_NATIVE_WEBVIEW_PERF", JSON.stringify({ records, mounted: 80, sample, gpu, systemInfo, deltaMs, domNodes: after.Nodes, jsHeapUsed: after.JSHeapUsedSize }));
} finally {
  await page.unroute(fixture);
  await session.detach();
  await browser.close();
}
