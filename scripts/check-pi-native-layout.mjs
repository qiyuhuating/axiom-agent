import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { createInterface } from "node:readline";

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
  for (const [width, height, deviceScaleFactor] of [
    [1440, 900, 1], [1280, 800, 1.25], [960, 640, 1.5], [720, 860, 2], [1920, 1080, 2],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor, colorScheme: "light" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(ready);
    await page.waitForFunction(() => document.querySelector("#status")?.textContent?.trim() === "就绪");
    const geometry = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
      const form = document.querySelector("#form");
      return {
        dpr: devicePixelRatio, width: innerWidth, height: innerHeight,
        header: rect("main > header"), form: rect("#form"), send: rect("#send"),
        bodyScroll: document.body.scrollWidth, rowScroll: form.scrollWidth, rowWidth: form.clientWidth,
        font: getComputedStyle(document.querySelector("#prompt")).fontSize,
        bg: getComputedStyle(document.body).backgroundColor
      };
    });
    assert.equal(geometry.dpr, deviceScaleFactor);
    assert.equal(geometry.font, "16px");
    assert.equal(geometry.bg, "rgb(252, 252, 253)");
    assert.ok(geometry.header.width > 0 && geometry.form.width > 0 && geometry.send.width > 0);
    assert.ok(geometry.form.x >= -1 && geometry.form.right <= width + 1, JSON.stringify(geometry));
    assert.ok(geometry.form.y >= 0 && geometry.form.bottom <= height + 1, JSON.stringify(geometry));
    assert.ok(geometry.send.right <= geometry.form.right + 1, JSON.stringify(geometry));
    assert.ok(geometry.bodyScroll <= width + 1 && geometry.rowScroll <= geometry.rowWidth + 1, JSON.stringify(geometry));
    await page.locator("#prompt").click();
    await page.keyboard.insertText("Pi fixture 中文");
    assert.match(await page.locator("#prompt").innerText(), /Pi fixture 中文/);
    if (width < 768) {
      await page.locator("#sidebar-open").click();
      await page.locator(".sidebar-backdrop").click();
    }
    await page.locator("#theme-toggle").click({ force: width < 768 }).catch(async () => {
      await page.locator("#sidebar-open").click();
      await page.locator("#theme-toggle").click();
    });
    assert.equal(await page.locator("body").evaluate(el => el.hasAttribute("data-ds-dark-theme")), true);
    assert.deepEqual(errors, []);
    console.log("PI_LAYOUT_PASS", JSON.stringify({width,height,deviceScaleFactor,font:geometry.font}));
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
