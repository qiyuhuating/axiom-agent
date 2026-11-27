import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const [port, baseUrl, mode, count] = process.argv.slice(2);
const records=Number(count);
assert.ok(Number.isInteger(records)&&records>=80&&records%4===0);
assert.match(port ?? "", /^\d+$/);
assert.match(baseUrl ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
assert.ok(mode === "A" || mode === "B");
assert.ok(process.env.AXIOM_TEST_PLAYWRIGHT_MODULE);
const { chromium } = await import(pathToFileURL(process.env.AXIOM_TEST_PLAYWRIGHT_MODULE).href);
const browser = await chromium.connectOverCDP("http://127.0.0.1:" + port);
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url() === baseUrl + "/");
assert.ok(page);
const session = await page.context().newCDPSession(page);
try {
  const initial=await fetch(baseUrl+"/api/snapshot?history=page",{signal:AbortSignal.timeout(30000)});
  if(!initial.ok){
    const failure=await initial.json();
    console.log("PI_RELEASE_AB_FAIL "+JSON.stringify({mode,records,status:initial.status,error:failure.error}));
    assert.ok(mode==="A" && /Maximum call stack size exceeded/.test(failure.error), "Unexpected benchmark failure");
  } else {
  await initial.body.cancel();
  await page.getByText("Native release fixture "+(records-1), { exact: false }).waitFor({timeout:30000});
  await page.bringToFront();
  assert.equal(await page.locator("#transcript [data-history-index]").count(), 80);
  await session.send("Performance.enable");
  const snapshot = await page.evaluate(async (records) => {
    const samples=[];
    for(let i=0;i<9;i++){
      const start=performance.now();
      const response=await fetch("/api/snapshot?history=page",{cache:"no-store"});
      if(!response.ok)throw Error("snapshot failed "+response.status);
      const text=await response.text();
      const decoded=performance.now();
      const value=JSON.parse(text);
      const finished=performance.now();
      if(value.messages.length!==80||value.history.total!==records||value.historyTools.tools.length!==records/4)throw Error("fixture mismatch");
      if(i>0)samples.push({responseMs:decoded-start,parseMs:finished-decoded,bytes:new TextEncoder().encode(text).length});
    }
    const median=(values)=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
    return {samples:samples.length,bytes:samples[0].bytes,medianResponseMs:median(samples.map(v=>v.responseMs)),medianParseMs:median(samples.map(v=>v.parseMs)),responseMs:samples.map(v=>v.responseMs)};
  },records);
  await session.send("HeapProfiler.collectGarbage");
  const metrics = async () => Object.fromEntries((await session.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
  const before=await metrics();
  const frame=await page.evaluate(async()=>{
    const el=document.querySelector("#transcript");
    el.scrollTop=0;
    const intervals=[];
    let previous;
    const deadline=performance.now()+15000;
    while(intervals.length<120){
      const now=await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(Error("Frame sample timed out")),Math.max(1,deadline-performance.now()));
        requestAnimationFrame(time=>{clearTimeout(timeout);resolve(time);});
      });
      if(previous!==undefined)intervals.push(now-previous);
      previous=now;
      el.scrollTop=(el.scrollTop+64)%Math.max(1,el.scrollHeight-el.clientHeight);
    }
    intervals.sort((a,b)=>a-b);
    return {samples:intervals.length,medianMs:intervals[Math.floor(intervals.length/2)],p95Ms:intervals[Math.ceil(intervals.length*.95)-1],maxMs:intervals.at(-1),width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visibility:document.visibilityState};
  });
  const after=await metrics();
  const deltaMs=Object.fromEntries(["TaskDuration","ScriptDuration","LayoutDuration","RecalcStyleDuration"].map(key=>[key,Math.round((after[key]-before[key])*100000)/100]));
  console.log("PI_RELEASE_AB "+JSON.stringify({mode,records,snapshot,frame,deltaMs,jsHeapUsed:before.JSHeapUsedSize,domNodes:before.Nodes}));
  }
}finally{
  await session.detach();
  await browser.close();
}
