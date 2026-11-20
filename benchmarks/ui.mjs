import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { isAbsolute,resolve,join } from "node:path";
import { mkdir,writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
const modulePath=process.env.AXIOM_TEST_PLAYWRIGHT_MODULE||"playwright";
const {chromium}=await import(isAbsolute(modulePath)?pathToFileURL(modulePath).href:modulePath);
const [port,base]=process.argv.slice(2);assert.match(port||"",/^\d+$/);assert.match(base||"",/^http:\/\/127\.0\.0\.1:\d+$/);
const out=resolve(process.env.AXIOM_BENCH_OUT||"benchmarks/results");await mkdir(out,{recursive:true});
const browser=await chromium.connectOverCDP("http://127.0.0.1:"+port,{timeout:20000});
try{
 const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith(base));assert.ok(page);
 const results={userAgent:await page.evaluate(()=>navigator.userAgent),navigation:await page.evaluate(()=>performance.getEntriesByType("navigation").map(e=>e.toJSON())),paints:await page.evaluate(()=>performance.getEntriesByType("paint").map(e=>e.toJSON())),terminalRoundTripMs:[]};
 const t=performance.now();
 await page.getByTitle("\u7ec8\u7aef",{exact:true}).click();
 const panel=page.locator(".wb-panel").filter({has:page.locator(".wb-terminal")});
 await panel.getByRole("button",{name:"\u65b0\u5efa",exact:true}).click();
 const waitText=needle=>page.waitForFunction(s=>document.querySelector(".xterm-rows")?.textContent.includes(s),needle,{timeout:20000});
 await waitText("PS ");results.terminalReadyMs=performance.now()-t;
 const textarea=page.locator(".xterm-helper-textarea");await textarea.focus();
 for(let i=0;i<30;i++){
  const marker="AXIOM_BENCH_"+i+"!";
  await page.keyboard.type("Write-Output ('AXIOM_'+'BENCH_"+i+"!')");
  const start=performance.now();await page.keyboard.press("Enter");await waitText(marker);results.terminalRoundTripMs.push(performance.now()-start);
 }
 await panel.getByRole("button",{name:"\u7ed3\u675f",exact:true}).click();
 const sorted=[...results.terminalRoundTripMs].sort((a,b)=>a-b);results.p50=sorted[Math.ceil(sorted.length*.5)-1];results.p95=sorted[Math.ceil(sorted.length*.95)-1];results.max=sorted.at(-1);
 await writeFile(join(out,"ui.json"),JSON.stringify(results,null,2));console.log("UI",JSON.stringify({ready:results.terminalReadyMs,p50:results.p50,p95:results.p95,max:results.max}));
}finally{await browser.close();}
