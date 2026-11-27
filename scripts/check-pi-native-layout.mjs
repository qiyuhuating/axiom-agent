import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { build } from "esbuild";

const modulePath = process.env.AXIOM_TEST_PLAYWRIGHT_MODULE;
assert.ok(modulePath, "Set AXIOM_TEST_PLAYWRIGHT_MODULE to an installed Playwright module");
const { chromium } = await import(pathToFileURL(modulePath).href);
const tmp = await mkdtemp(join(tmpdir(), "axiom-pi-layout-"));
const portServer = createServer();
portServer.listen(0, "127.0.0.1");
await once(portServer, "listening");
const runtimePort = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const config = join(tmp, "config.json");
await writeFile(config, JSON.stringify({
  workspace: join(tmp, "workspace"), sessionDir: join(tmp, "sessions"),
  runtimePort, discoverContext: false
}));
const env = { ...process.env, AXIOM_CONFIG: config, AXIOM_DESKTOP: "1", PI_CODING_AGENT_DIR: join(tmp, "pi-agent") };
const host = spawn(process.execPath, ["src/server.mjs"], { env, stdio: ["pipe", "pipe", "inherit"], windowsHide: true });
let browser;
try {
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Host startup timed out")), 30000);
    const lines = createInterface({ input: host.stdout });
    lines.on("line", (line) => {
      if (line.startsWith("AXIOM_READY ")) {
        clearTimeout(timer);
        resolve("http://127.0.0.1:" + line.slice(12));
      }
    });
    host.once("exit", (code) => { clearTimeout(timer); reject(Error("Host exited: " + code)); });
  });
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_CHROME || undefined, headless: true });
  const displays = [
    [1440, 900, 1], [1280, 800, 1.25], [960, 640, 1.5], [720, 860, 2],
    ...[1, 1.25, 1.5, 2].flatMap(dpr => [[Math.round(2560 / dpr), Math.round(1440 / dpr), dpr], [Math.round(3840 / dpr), Math.round(2160 / dpr), dpr]]),
  ];
  for (const [width, height, deviceScaleFactor] of displays) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor, colorScheme: "light" });
    const page = await context.newPage();
    const verifyStream = width === 1440 && deviceScaleFactor === 1;
    if (verifyStream) {
      await page.addInitScript(() => {
        const NativeEventSource = window.EventSource;
        window.EventSource = class extends NativeEventSource {
          constructor(...args) {
            super(...args);
            window.axiomTestEvents = this;
          }
        };
      });
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    }
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(ready);
    await page.waitForFunction(() => document.querySelector("#status")?.textContent?.trim() === "就绪");
    if (verifyStream && process.env.AXIOM_TEST_SCREENSHOTS) {
      await page.screenshot({ path: join(process.env.AXIOM_TEST_SCREENSHOTS, "pi-light.jpg"), quality: 85, animations: "disabled" });
    }
    const geometry = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
      const form = document.querySelector("#form");
      return {
        dpr: devicePixelRatio, width: innerWidth, height: innerHeight,
        header: rect("main > header"), form: rect("#form"), send: rect("#send"), welcome: rect(".welcome"), mark: rect(".pi-hero-mark"), model: rect("#models"),
        bodyScroll: document.body.scrollWidth, rowScroll: form.scrollWidth, rowWidth: form.clientWidth,
        font: getComputedStyle(document.querySelector("#prompt")).fontSize,
        bg: getComputedStyle(document.body).backgroundColor
      };
    });
    assert.equal(geometry.dpr, deviceScaleFactor);
    assert.equal(geometry.width, width);
    assert.equal(geometry.height, height);
    // PNG IHDR measures actual raster pixels, not only CSS viewport dimensions.
    const png = await page.screenshot({ scale: "device" });
    const pixelWidth = png.readUInt32BE(16);
    const pixelHeight = png.readUInt32BE(20);
    assert.ok(Math.abs(pixelWidth - width * deviceScaleFactor) <= 1);
    assert.ok(Math.abs(pixelHeight - height * deviceScaleFactor) <= 1);
    if (width >= 2560) assert.ok(geometry.form.width >= 1000, JSON.stringify(geometry));
    assert.equal(geometry.font, "16px");
    assert.equal(geometry.bg, "rgb(252, 252, 253)");
    assert.ok(geometry.header.width > 0 && geometry.form.width > 0 && geometry.send.width > 0);
    assert.ok(geometry.form.x >= -1 && geometry.form.right <= width + 1, JSON.stringify(geometry));
    assert.ok(geometry.form.y >= 0 && geometry.form.bottom <= height + 1, JSON.stringify(geometry));
    assert.ok(geometry.send.right <= geometry.form.right + 1, JSON.stringify(geometry));
    assert.ok(geometry.model.width >= 65, JSON.stringify(geometry));
    const center = rect => rect.x + rect.width / 2;
    assert.ok(Math.abs(center(geometry.mark) - center(geometry.form)) <= 2, JSON.stringify(geometry));
    assert.ok(geometry.bodyScroll <= width + 1 && geometry.rowScroll <= geometry.rowWidth + 1, JSON.stringify(geometry));
    const starters = page.locator(".pi-starter-tasks button");
    assert.equal(await starters.count(), 3);
    const taskBounds = await page.locator(".pi-starter-tasks").boundingBox();
    assert.ok(taskBounds && taskBounds.y >= 0 && taskBounds.y + taskBounds.height <= height + 1);
    assert.equal(await page.locator("#stop").isVisible(), false);
    await starters.first().click();
    assert.match(await page.locator("#prompt").innerText(), /阅读当前项目/);
    assert.equal(await page.locator("#prompt").evaluate(el => document.activeElement === el), true);
    await page.locator("#prompt").click();
    await page.keyboard.insertText("Pi fixture 中文");
    assert.match(await page.locator("#prompt").innerText(), /Pi fixture 中文/);
    await starters.nth(1).click();
    const draft = await page.locator("#prompt").innerText();
    assert.match(draft, /Pi fixture 中文/);
    assert.match(draft, /检查当前项目/);
    if (width < 768) {
      await page.locator("#sidebar-open").click();
      await page.locator(".sidebar-backdrop").click();
    }
    await page.locator("#theme-toggle").click({ force: width < 768 }).catch(async () => {
      await page.locator("#sidebar-open").click();
      await page.locator("#theme-toggle").click();
    });
    assert.equal(await page.locator("body").evaluate(el => el.hasAttribute("data-ds-dark-theme")), true);
    if (verifyStream) {
      if (process.env.AXIOM_TEST_SCREENSHOTS) {
        await page.screenshot({ path: join(process.env.AXIOM_TEST_SCREENSHOTS, "pi-dark.jpg"), quality: 85, animations: "disabled" });
      }
      // Exercise the actual UI against synthetic Pi events, without paid inference.
      await page.evaluate(() => {
        window.axiomAppEvents = window.axiomTestEvents;
        const send = event => window.axiomAppEvents.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) }));
        send({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Pi stream" } });
        send({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: " verified" } });
      });
      await page.locator(".pi-live-message").getByText("Pi stream verified").waitFor();
      await page.evaluate(() => window.axiomAppEvents.dispatchEvent(new MessageEvent("message", {
        data: JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Pi stream verified" }] } })
      })));
      await page.locator(".pi-live-message").waitFor({ state: "detached" });
      const reply = page.locator(".axiom-message.assistant").last();
      await reply.hover();
      await reply.getByRole("button", { name: "复制消息" }).click();
      await reply.getByRole("button", { name: "已复制" }).waitFor();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "Pi stream verified");

      // Verify shell snapshots remain referentially stable on actual projection events.
      const bundle = await build({ entryPoints: ["ui/projection.ts"], bundle: true, format: "esm", write: false, logLevel: "silent" });
      await page.route("**/__pi-projection-fixture.js", route => route.fulfill({
        contentType: "text/javascript", body: bundle.outputFiles[0].text
      }));
      await page.evaluate(async () => {
        window.axiomProjectionFixture = await import("/__pi-projection-fixture.js");
        window.axiomProjectionClose = window.axiomProjectionFixture.connect();
      });
      await page.waitForFunction(() => {
        const s = window.axiomProjectionFixture.getSnapshot();
        return s.connected && !s.syncing && !!s.state?.sessionId;
      });
      const counts = await page.evaluate(() => {
        const p = window.axiomProjectionFixture;
        const send = event => window.axiomTestEvents.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) }));
        let shell = p.getShellSnapshot();
        let draftChanges = 0, streamChanges = 0;
        for (let i = 0; i < 100; i++) {
          p.setDraft("fixture " + i);
          if (p.getShellSnapshot() !== shell) draftChanges++;
          shell = p.getShellSnapshot();
        }
        for (let i = 0; i < 100; i++) {
          send({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "x" } });
          if (p.getShellSnapshot() !== shell) streamChanges++;
          shell = p.getShellSnapshot();
        }
        const streamLength = p.getSnapshot().stream.length;
        send({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }] } });
        if (p.getShellSnapshot() !== shell) streamChanges++;
        window.axiomProjectionClose();
        return { draftChanges, streamChanges, streamLength };
      });
      assert.deepEqual(counts, { draftChanges: 0, streamChanges: 2, streamLength: 100 });
      console.log("PI_SUBSCRIPTION_PASS", JSON.stringify(counts));
    }
    assert.deepEqual(errors, []);
    console.log("PI_LAYOUT_PASS", JSON.stringify({width,height,deviceScaleFactor,pixelWidth,pixelHeight,font:geometry.font}));
    await context.close();
  }
} finally {
  await browser?.close();
  const stop = spawn(process.execPath, ["scripts/runtime-stop.mjs"], { env, stdio: "ignore", windowsHide: true });
  await once(stop, "exit");
  const exited = once(host, "exit");
  host.stdin.end();
  if (host.exitCode === null) await exited;
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
