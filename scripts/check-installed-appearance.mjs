import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { isAbsolute,join } from "node:path";
const modulePath = process.env.AXIOM_TEST_PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
import { mkdir } from "node:fs/promises";
const [port,base]=process.argv.slice(2);
assert.match(port || "", /^\d+$/);
assert.match(base || "", /^http:\/\/127\.0\.0\.1:\d+$/);
const directory=process.env.AXIOM_UI_SCREENSHOT_DIR;
const capture=async(page,name)=>{if(directory){await mkdir(directory,{recursive:true});await page.screenshot({path:join(directory,name)});}};
const browser=await chromium.connectOverCDP("http://127.0.0.1:"+port);
try{
 const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith(base));assert.ok(page);
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.waitForFunction(()=>document.querySelector("#status")?.textContent==="就绪",null,{timeout:30000});
 await page.evaluate(()=>localStorage.setItem("axiom.appearance","light"));await page.reload();
 await page.locator("#theme-toggle svg").waitFor();
 assert.equal(await page.locator("body").getAttribute("data-ds-dark-theme"),null);
 assert.equal(await page.locator(".inspector").isVisible(),false);
 const theme=()=>page.evaluate(()=>({bg:getComputedStyle(document.body).backgroundColor,sidebar:getComputedStyle(document.querySelector(".sidebar")).backgroundColor,radius:getComputedStyle(document.querySelector(".composer form")).borderRadius}));
 const a=await theme();assert.equal(a.bg,"rgb(255, 255, 255)");assert.equal(a.radius,"28px");
 await capture(page,"light.png");
 await page.locator("#theme-toggle").click();assert.ok((await theme()).bg!=="rgb(255, 255, 255)");await capture(page,"dark.png");
 if(await page.locator("#sidebar-toggle").isVisible()){await page.locator("#sidebar-toggle").click();assert.equal(await page.locator(".sidebar").evaluate(e=>e.offsetWidth),56);await page.locator("#sidebar-open").click();}
 await page.locator("#theme-toggle").click();
 await page.locator("#show-workbench").click();await page.getByTitle("终端",{exact:true}).waitFor();await capture(page,"workbench.png");
 await page.locator("#show-workbench").click();
 assert.deepEqual(errors,[]);console.log("HARNESS_UI_RENDER_PASS",JSON.stringify(a));
}finally{await browser.close();}
