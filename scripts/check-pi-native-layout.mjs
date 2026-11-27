import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { build } from "esbuild";
import { historyPage, historyTools } from "../src/history-page.mjs";
import { toolTextPage } from "../src/tool-history-page.mjs";

const modulePath = process.env.AXIOM_TEST_PLAYWRIGHT_MODULE;
assert.ok(modulePath, "Set AXIOM_TEST_PLAYWRIGHT_MODULE to an installed Playwright module");
const { chromium } = await import(pathToFileURL(modulePath).href);
const tmp = await mkdtemp(join(tmpdir(), "axiom-pi-layout-"));
const portServer = createServer();
portServer.listen(0, "127.0.0.1");
await once(portServer, "listening");
const runtimePort = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
await mkdir(join(tmp, "workspace", "src"), { recursive: true });
await writeFile(join(tmp, "workspace", "src", "fixture.ts"), "export const answer = 42;\r\n");
await writeFile(join(tmp, "workspace", "readme.md"), "# Fixture\n");
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
      await page.screenshot({ path: join(process.env.AXIOM_TEST_SCREENSHOTS, "axiom-dark.jpg"), quality: 85, animations: "disabled" });
    }
    const geometry = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
      const form = document.querySelector("#form");
      return {
        dpr: devicePixelRatio, width: innerWidth, height: innerHeight,
        header: rect("main > header"), form: rect("#form"), send: rect("#send"), welcome: rect(".welcome"), mark: rect(".pi-welcome-title"), model: rect("#models"),
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
    assert.equal(await page.locator(".pi-mark,.pi-hero-mark").count(), 0);
    const palette = await page.evaluate(() => {
      const color = (selector, property) => getComputedStyle(document.querySelector(selector))[property];
      return [color("body","backgroundColor"),color(".sidebar","backgroundColor"),color("#form","backgroundColor"),color("#send","backgroundColor"),color("#send","color"),color("#new","backgroundColor")];
    });
    for (const value of palette) {
      const channels = value.match(/\d+/g)?.slice(0,3).map(Number);
      assert.ok(channels?.length === 3 && channels.every(channel => channel === channels[0]), "Non-neutral shell color: " + value);
    }
    assert.equal(palette[3], "rgb(238, 238, 238)");
    assert.equal(palette[4], "rgb(23, 23, 23)");
    assert.equal(geometry.bg, "rgb(16, 16, 16)");
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
    assert.equal(await page.locator("body").evaluate(el => el.hasAttribute("data-ds-dark-theme")), false);
    if (verifyStream) {
      if (process.env.AXIOM_TEST_SCREENSHOTS) {
        await page.screenshot({ path: join(process.env.AXIOM_TEST_SCREENSHOTS, "axiom-light.jpg"), quality: 85, animations: "disabled" });
      }
      await page.locator("#theme-toggle").click();
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

      // The command palette must use actual focus and navigation, without executing prompts.
      const commandTrigger = page.getByRole("button", { name: "快速操作", exact: true });
      await commandTrigger.focus();
      await page.keyboard.press("Control+Shift+P");
      const palette = page.getByRole("dialog", { name: "快速操作", exact: true });
      const commandSearch = palette.getByRole("searchbox", { name: "搜索操作" });
      await palette.waitFor();
      assert.equal(await commandSearch.evaluate(el => document.activeElement === el), true);
      await page.mouse.move(10,10);
      assert.equal(await page.locator(".pi-modal-mask").evaluate(el=>getComputedStyle(el).backgroundColor),"rgba(0, 0, 0, 0.48)");
      if (process.env.AXIOM_TEST_SCREENSHOTS) await page.screenshot({path:join(process.env.AXIOM_TEST_SCREENSHOTS,"axiom-commands.jpg"),quality:85,animations:"disabled"});
      await commandSearch.press("ArrowDown");
      assert.match(await palette.locator('[aria-current="true"]').innerText(),/聚焦输入区/);
      await commandSearch.fill("not-a-real-command");
      assert.equal(await palette.getByRole("status").textContent(), "未找到匹配操作");
      await page.keyboard.press("Escape");
      await palette.waitFor({state:"detached"});
      assert.equal(await commandTrigger.evaluate(el => document.activeElement === el), true);
      await commandTrigger.click();
      await commandSearch.fill("Composer");
      await commandSearch.press("Enter");
      await palette.waitFor({state:"detached"});
      await page.waitForFunction(() => document.activeElement?.id === "prompt");
      await page.keyboard.press("Control+Shift+P");
      await commandSearch.fill("文件");
      await commandSearch.press("Enter");
      await palette.waitFor({state:"detached"});
      await page.locator(".pi-file-explorer").waitFor();
      await page.locator("#rightbar-collapse").click();
      console.log("AXIOM_COMMAND_PASS",JSON.stringify({shortcut:true,search:true,escapeFocus:true,composerFocus:true,fileNavigation:true}));

      // Protect reading space before the user deliberately enlarges the workbench.
      await page.locator("#sidebar-panels").getByRole("button", { name: "文件", exact: true }).click();
      const separator = page.getByRole("separator", { name: "调整右侧栏宽度" });
      await separator.waitFor();
      const columns = () => page.evaluate(() => {
        const width = selector => document.querySelector(selector).getBoundingClientRect().width;
        return { sidebar: width(".sidebar"), center: width(".pi-center"), right: width(".inspector") };
      });
      const initialColumns = await columns();
      assert.ok(initialColumns.center >= 720, JSON.stringify(initialColumns));
      assert.ok(initialColumns.right >= 360 && initialColumns.right <= 480, JSON.stringify(initialColumns));
      await separator.focus();
      await separator.press("End");
      await page.waitForFunction(() => document.querySelector(".axiom-rightbar-resize")?.getAttribute("aria-valuenow") === document.querySelector(".axiom-rightbar-resize")?.getAttribute("aria-valuemax"));
      const widest = await columns();
      assert.ok(widest.center >= 560, JSON.stringify(widest));
      await separator.press("Home");
      await page.waitForFunction(() => document.querySelector(".axiom-rightbar-resize")?.getAttribute("aria-valuenow") === "300");
      await separator.press("Shift+ArrowLeft");
      await page.waitForFunction(() => document.querySelector(".axiom-rightbar-resize")?.getAttribute("aria-valuenow") === "364");
      // Restore the default test layout before exercising existing file/editor behavior.
      for(let i=0;i<4;i++) await separator.press("ArrowLeft");
      await page.waitForFunction(() => document.querySelector(".axiom-rightbar-resize")?.getAttribute("aria-valuenow") === "428");
      assert.equal(await page.evaluate(() => localStorage.getItem("axiom.rightbar.width")), "428");
      const edge = await separator.boundingBox();
      assert.ok(edge);
      await page.mouse.move(edge.x + edge.width/2,edge.y + edge.height/2);
      await page.mouse.down();
      await page.mouse.move(edge.x + edge.width/2 - 36,edge.y + edge.height/2,{steps:6});
      await page.mouse.up();
      await page.waitForFunction(() => document.querySelector(".axiom-rightbar-resize")?.getAttribute("aria-valuenow") === "464");
      assert.equal(await page.evaluate(() => localStorage.getItem("axiom.rightbar.width")), "464");
      await page.setViewportSize({width:1024,height:900});
      await page.waitForFunction(() => document.body.classList.contains("workbench-overlay"));
      assert.equal(await separator.count(),0);
      const overlay = await columns();
      assert.ok(overlay.center >= 760,JSON.stringify(overlay));
      await page.setViewportSize({width:1440,height:900});
      await separator.waitFor();
      await page.waitForFunction(() => document.querySelector(".axiom-rightbar-resize")?.getAttribute("aria-valuenow") === "464");
      await separator.press("ArrowRight");
      await separator.press("ArrowRight");
      console.log("AXIOM_COLUMNS_PASS",JSON.stringify({initialColumns,widest,keyboardResize:true,pointerResize:true,overlay,restoredWidth:464}));
      await page.locator("#rightbar-collapse").click();

      // The explorer must open real workspace entries; collapsing and
      // reopening a directory must not issue a second listing request.
      let directoryRequests = 0;
      page.on("request", request => {
        const url = new URL(request.url());
        if (url.pathname === "/api/files" && url.searchParams.get("path") === "src") directoryRequests++;
      });
      await page.locator("#sidebar-panels").getByRole("button", { name: "文件", exact: true }).click();
      const explorer = page.locator(".pi-file-explorer");
      const directory = explorer.locator('[data-path="src"]');
      const file = explorer.locator('[data-path="src/fixture.ts"]');
      await directory.waitFor();
      await directory.focus();
      await page.keyboard.press("ArrowRight");
      await file.waitFor();
      assert.equal(directoryRequests, 1);
      await page.keyboard.press("ArrowRight");
      assert.equal(await file.evaluate(el => document.activeElement === el), true);
      await page.keyboard.press("ArrowLeft");
      assert.equal(await directory.evaluate(el => document.activeElement === el), true);
      await directory.click();
      await file.waitFor({ state: "detached" });
      await directory.click();
      await file.waitFor();
      assert.equal(directoryRequests, 1);
      await explorer.getByRole("searchbox", { name: "筛选已加载文件" }).fill("fixture.ts");
      await file.waitFor();
      assert.equal(await explorer.locator(".pi-file-row").count(), 1);
      await explorer.getByRole("searchbox", { name: "筛选已加载文件" }).fill("");
      if (process.env.AXIOM_TEST_SCREENSHOTS) {
        await page.screenshot({ path: join(process.env.AXIOM_TEST_SCREENSHOTS, "pi-files.jpg"), quality: 85, animations: "disabled" });
      }
      await file.click();
      await page.locator(".inspector .cm-editor").waitFor();
      assert.match(await page.locator(".inspector .cm-editor").innerText(), /answer = 42/);
      const keywordColor = await page.locator(".inspector .cm-content").evaluate(el => {
        const keyword = Array.from(el.querySelectorAll("span")).find(span => span.textContent === "export");
        return keyword && getComputedStyle(keyword).color;
      });
      assert.equal(keywordColor, "rgb(198, 164, 242)");
      const editorContent=page.locator(".inspector .cm-content");
      await editorContent.click();
      await page.keyboard.press("Control+End");
      await page.keyboard.insertText("export const next = 43;");
      const saveButton=page.locator(".inspector").getByRole("button",{name:"保存",exact:true});
      await saveButton.waitFor();
      assert.equal(await saveButton.isEnabled(),true);
      await page.keyboard.press("Control+z");
      await page.waitForFunction(()=>Array.from(document.querySelectorAll(".inspector button")).some(b=>b.textContent.trim()==="保存"&&b.disabled));
      await page.keyboard.press("Control+y");
      await saveButton.click();
      await page.waitForFunction(()=>Array.from(document.querySelectorAll(".inspector button")).some(b=>b.textContent.trim()==="保存"&&b.disabled));
      assert.equal(await readFile(join(tmp,"workspace","src","fixture.ts"),"utf8"),"export const answer = 42;\r\nexport const next = 43;");
      await page.locator("#sidebar-panels").getByRole("button", { name: "文件", exact: true }).click();
      await directory.waitFor();
      assert.equal(directoryRequests, 1);
      await explorer.getByRole("button", { name: "刷新文件" }).click();
      await page.waitForFunction(() => !document.querySelector(".pi-file-explorer [role=status]"));
      assert.equal(directoryRequests, 2);
      console.log("PI_EXPLORER_PASS", JSON.stringify({ directoryRequests, cachedReopen: true, fileOpened: true }));

      // Reopen a large synthetic persisted conversation using the real
      // snapshot protocol. No paid provider or filesystem changes are needed.
      const history = Array.from({ length: 2000 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: [{ type: "text", text: "History fixture " + i + "\n" + "A meaningful line of history.\n".repeat(3) }]
      }));
      const toolResults = Array.from({ length: 500 }, (_, i) => ({
        role: "toolResult", toolCallId: "trace-" + i,
        toolName: i % 2 ? "read" : "write", isError: i % 10 === 0,
        content: [{ type: "text", text: "Tool fixture result " + i + (i === 490 ? "x".repeat(50000) : "") }]
      }));
      await page.route("**/api/snapshot*", async route => {
        const response = await route.fetch();
        const snapshot = await response.json();
        const raw = [...history, ...toolResults];
        const from = new URL(route.request().url()).searchParams.get("from");
        await route.fulfill({ response, json: { ...snapshot, ...historyPage(raw, snapshot.state.sessionId, { from }), historyTools: historyTools(raw, { summaries: true }) } });
      });
      await page.reload();
      await page.route("**/api/history?*", async route => {
        const before = new URL(route.request().url()).searchParams.get("before");
        const sessionId = JSON.parse(Buffer.from(before, "base64url").toString()).sessionId;
        await route.fulfill({ json: historyPage(history, sessionId, { before }) });
      });
      await page.getByText("History fixture 1999", { exact: false }).waitFor();
      const articles = page.locator("#transcript [data-history-index]");
      assert.equal(await articles.count(), 80);
      assert.equal(await articles.first().getAttribute("data-history-index"), "1920");
      const transcript = page.locator("#transcript");
      await transcript.evaluate(el => { el.scrollTop = 0; });
      const loadOlder = page.getByRole("button", { name: /加载更早消息/ });
      await loadOlder.waitFor();
      const oldAnchor = page.locator('[data-history-index="1920"]');
      const oldTop = await oldAnchor.evaluate(el => el.getBoundingClientRect().top);
      await loadOlder.click();
      await page.waitForFunction(() => document.querySelectorAll("#transcript [data-history-index]").length === 160);
      const newTop = await oldAnchor.evaluate(el => el.getBoundingClientRect().top);
      assert.ok(Math.abs(oldTop - newTop) <= 3, JSON.stringify({ oldTop, newTop }));
      await page.getByRole("button", { name: "仅显示最近消息" }).click();
      await page.waitForFunction(() => document.querySelectorAll("#transcript [data-history-index]").length === 80);
      assert.equal(await articles.count(), 80);
      await page.getByRole("button", { name: "回到最新消息" }).click();
      await page.waitForFunction(() => {
        const el = document.querySelector("#transcript");
        return el.scrollHeight - el.scrollTop - el.clientHeight < 2;
      });
      console.log("PI_HISTORY_PASS", JSON.stringify({ records: 2000, initialMounted: 80, expandedMounted: 160, anchorDrift: Math.abs(oldTop - newTop) }));

      await page.locator("#sidebar-panels").getByRole("button", { name: "执行轨迹", exact: true }).click();
      const ledger = page.locator(".pi-tool-ledger");
      await ledger.waitFor();
      assert.equal(await ledger.locator('[data-kind="tool"]').count(), 100);
      await ledger.getByRole("button", { name: "失败 50" }).click();
      assert.equal(await ledger.locator('[data-kind="tool"]').count(), 50);
      let detailRequests=0;
      await page.route("**/api/tool-history?*", async route => {
        detailRequests++;
        const id = new URL(route.request().url()).searchParams.get("id");
        const detail=historyTools(toolResults,{only:id}).tools[0];
                const params=new URL(route.request().url()).searchParams;
        const field=params.get("field");
        const value=field ? toolTextPage(detail[field],Number(params.get("offset")),params.get("revision")) : {args:toolTextPage(detail.args),result:toolTextPage(detail.result)};
        await route.fulfill({ json:value });
      });
      assert.equal(detailRequests,0);
      await ledger.locator(".pi-tool-row").first().click();
      await ledger.getByText(/Tool fixture result 490/).waitFor();
      assert.equal(detailRequests,1);
      const payload=ledger.locator(".pi-tool-detail pre").last();
      assert.ok((await payload.innerText()).length<=16384);
      await ledger.getByRole("button",{name:"下一段",exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector(".pi-tool-detail pre:last-of-type")?.textContent?.includes("Tool fixture result 490"));
      assert.ok((await payload.innerText()).length<=16384);
      await ledger.getByRole("button",{name:"上一段",exact:true}).click();
      await ledger.getByText(/Tool fixture result 490/).waitFor();
      assert.equal(detailRequests,3);
      assert.match(await ledger.locator(".pi-tool-detail").innerText(), /Tool fixture result 490/);
      await ledger.getByRole("searchbox", { name: "筛选工具名称" }).fill("read");
      assert.equal(await ledger.locator('[data-kind="tool"]').count(), 0);
      await ledger.getByRole("searchbox", { name: "筛选工具名称" }).fill("");
      await ledger.getByRole("button", { name: "全部 500" }).click();
      await ledger.getByRole("button", { name: /查看更早的工具记录/ }).click();
      assert.equal(await ledger.locator('[data-kind="tool"]').count(), 200);
      if (process.env.AXIOM_TEST_SCREENSHOTS) {
        await page.screenshot({ path: join(process.env.AXIOM_TEST_SCREENSHOTS, "pi-trajectory.jpg"), quality: 85, animations: "disabled" });
      }
      await page.locator("#sidebar-panels").getByRole("button", { name: "文件", exact: true }).click();
      await ledger.waitFor({ state: "detached" });
      await page.locator("#sidebar-panels").getByRole("button", { name: "执行轨迹", exact: true }).click();
      await ledger.waitFor();
      assert.equal(await ledger.locator('[data-kind="tool"]').count(), 100);
      await page.route("**/api/diff",route=>route.fulfill({json:{available:true,status:" M fixture.ts",unstaged:Array.from({length:1500},(_,i)=>"+line "+i).join("\n"),staged:""}}));
      await page.locator("#sidebar-panels").getByRole("button",{name:"Git Diff",exact:true}).click();
      const patch=page.locator(".inspector .git-patch").first();
      await patch.waitFor();
      assert.equal(await patch.locator("div").count(),500);
      await page.locator(".inspector").getByRole("button",{name:"加载更多差异"}).click();
      assert.equal(await patch.locator("div").count(),1000);
      await page.unroute("**/api/diff");
      console.log("PI_TRACE_PASS", JSON.stringify({ records: 500, initialMounted: 100, failed: 50, expandedMounted: 200, hiddenUnmounted: true, detailRequests, diffInitial:500 }));
      await page.unroute("**/api/snapshot*");
      await page.unroute("**/api/history?*");
      await page.unroute("**/api/tool-history?*");

      // Tab from model search must move focus, not change the selected model.
      const fixtureModels = Array.from({ length: 5 }, (_, i) => ({ provider: "fixture", id: "model-" + i }));
      await page.route("**/api/models", route => route.fulfill({ json: fixtureModels }));
      let modelActions = 0;
      await page.route("**/api/action", route => {
        if (route.request().postDataJSON()?.action === "model") {
          modelActions++;
          return route.fulfill({ json: {} });
        }
        return route.continue();
      });
      await page.reload();
      await page.waitForFunction(() => document.querySelector("#status")?.textContent?.trim() === "就绪");
      await page.locator("#models").click();
      await page.getByRole("menuitem", { name: /^模型/ }).click();
      const modelSearch = page.getByRole("textbox", { name: "搜索模型" });
      await modelSearch.waitFor();
      await modelSearch.fill("model-");
      await page.keyboard.press("Tab");
      assert.equal(await page.locator('[role="menuitemradio"]').first().evaluate(el => document.activeElement === el), true);
      assert.equal(modelActions, 0);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.getByRole("menu", { name: "模型和思考强度" }).waitFor({ state: "detached" });
      await page.unroute("**/api/models");
      await page.unroute("**/api/action");
      console.log("PI_MODEL_KEYBOARD_PASS", JSON.stringify({ modelActions, focusMoved: true }));
      const trigger=page.getByRole("button",{name:"会话管理"});
      await trigger.click();
      const dialog=page.getByRole("dialog",{name:"会话管理"});
      await dialog.waitFor();
      await page.keyboard.press("Tab");
      assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true);
      await page.keyboard.press("Escape");
      await dialog.waitFor({state:"detached"});
      assert.equal(await trigger.evaluate(el=>document.activeElement===el),true);
      console.log("PI_MODAL_FOCUS_PASS");
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
