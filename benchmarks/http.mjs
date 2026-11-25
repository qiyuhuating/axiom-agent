import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { cpus, platform, release } from "node:os";
import { performance } from "node:perf_hooks";
const out=resolve(process.env.AXIOM_BENCH_OUT || "benchmarks/results");
const root=resolve(process.env.AXIOM_BENCH_RUNTIME || ".desktop-runtime");
const node=process.execPath, daemon=join(root,"bin/axiom-daemon.exe");
const count=Number(process.env.AXIOM_BENCH_COUNT || 400);
assert.ok(Number.isInteger(count)&&count>=100);
await mkdir(out,{recursive:true});
async function port(){const s=createServer();s.listen(0,"127.0.0.1");await once(s,"listening");const p=s.address().port;await new Promise(r=>s.close(r));return p;}
export function stats(samples){const sorted=[...samples].sort((a,b)=>a-b);const at=p=>sorted[Math.ceil(sorted.length*p)-1];return {n:sorted.length,p50:at(.5),p95:at(.95),p99:at(.99),mean:sorted.reduce((a,b)=>a+b,0)/sorted.length};}
async function measure(fn,n=count){for(let i=0;i<40;i++)await fn();const values=[];for(let i=0;i<n;i++){const t=performance.now();await fn();values.push(performance.now()-t);}return stats(values);}
async function waitUntil(fn){for(let i=0;i<120;i++){const v=await fn();if(v)return v;await delay(100);}throw Error("Readiness timeout");}
async function scenario(kind,profile=false){
 const dir=await mkdtemp(join(tmpdir(),"axiom-bench-")), workspace=join(dir,"workspace"),sessionDir=join(dir,"sessions"), config=join(dir,"config.json");
 const runtimePort=await port(),rustTerminalPort=await port(),token=randomBytes(32).toString("hex");
 await mkdir(workspace);await mkdir(sessionDir);await writeFile(join(sessionDir,"runtime.token"),token);
 await writeFile(config,JSON.stringify({workspace,sessionDir,runtimePort,rustTerminalPort,terminalBackend:"rust",discoverContext:false}));
 const env={...process.env,AXIOM_CONFIG:config,AXIOM_DESKTOP:"1",PI_CODING_AGENT_DIR:join(dir,"pi-agent")};
 const headers={Authorization:"Bearer "+token};
 const privateBase="http://127.0.0.1:"+runtimePort, terminalBase="http://127.0.0.1:"+rustTerminalPort;
 const start=performance.now();
 const host=join(root,"src/server.mjs");
 const child=kind==="gateway"?spawn(daemon,["--gateway",node,host],{env,stdio:["pipe","pipe","pipe"],windowsHide:true}):
 spawn(node,[...(profile?["--cpu-prof","--cpu-prof-dir="+out,"--cpu-prof-name=host.cpuprofile"]:[]),host],{env,stdio:["pipe","pipe","pipe"],windowsHide:true});
 const exited=once(child,"exit");let stderr="",base;child.stderr.on("data",d=>{stderr+=d;});const lines=createInterface({input:child.stdout});lines.on("line",line=>{if(line.startsWith("AXIOM_READY "))base="http://127.0.0.1:"+line.slice(12);});
 const get=async(url,options)=>{const r=await fetch(url,{...options,signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error(await r.text());return r.json();};
 try{
  await waitUntil(()=>{if(child.exitCode!==null)throw Error(stderr);return base;});const hostReadyMs=performance.now()-start;
  const health=await waitUntil(async()=>{try{return await get(base+"/api/runtime-health");}catch{return false;}});
  const runtimeReadyMs=performance.now()-start;
  const terminal=await get(terminalBase+"/api/runtime-health",{headers});
  const t=performance.now();await get(base+"/api/state");const piStateFirstMs=performance.now()-t;
  const metrics={hostReadyMs,runtimeReadyMs,piStateFirstMs};
  for(const [name,url,opts] of [["directRustTerminal",terminalBase+"/api/terminals",{headers}],["directNodeRuntime",privateBase+"/api/terminals",{headers}],["publicTerminal",base+"/api/terminals"],["publicHealth",base+"/api/runtime-health"],["publicPiState",base+"/api/state"]]){
    metrics[name]=await measure(()=>get(url,opts),profile?Math.max(count,1600):count);
  }
  // Sample exactly the fixture processes, not unrelated applications.
  const roots=[...new Set([child.pid,health.pid,terminal.pid])];
  const ps="Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress";
  const all=JSON.parse(execFileSync("pwsh",["-NoProfile","-Command",ps],{encoding:"utf8",windowsHide:true}));
  const pids=new Set(roots);
  for(let changed=true;changed;){changed=false;for(const p of all){if(pids.has(p.ParentProcessId)&&!pids.has(p.ProcessId)){pids.add(p.ProcessId);changed=true;}}}
  const query="Get-Process -Id "+[...pids].join(",")+" | Select-Object Id,ProcessName,CPU,PrivateMemorySize64,WorkingSet64,Handles | ConvertTo-Json -Compress";
  const readProcesses=()=>JSON.parse(execFileSync("pwsh",["-NoProfile","-Command",query],{encoding:"utf8",windowsHide:true}));
  const before=readProcesses();const idleStart=performance.now();await delay(3000);const after=readProcesses();metrics.idle={elapsedMs:performance.now()-idleStart,before,after};
  return metrics;
 } finally {
  try{await fetch(privateBase+"/api/runtime-stop",{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(5000)});await waitUntil(async()=>{try{await get(privateBase+"/api/runtime-health",{headers});return false;}catch{return true;}});}catch{}
  child.stdin.end();await Promise.race([exited,delay(8000,undefined,{ref:false})]);if(child.exitCode===null&&child.signalCode===null){child.kill();await exited;throw Error("Host failed graceful close");}lines.close();if(stderr)console.error(stderr);await rm(dir,{recursive:true,force:true,maxRetries:8,retryDelay:200});
 }
}
const profile=process.argv.includes("--profile");
const hashes=Object.fromEntries(await Promise.all(["bin/axiom-daemon.exe","src/runtime-client.mjs","src/server.mjs","package-lock.json"].map(async path=>[path,createHash("sha256").update(await readFile(join(root,path))).digest("hex")])));
const report={hashes,sha:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),dirty:!!execFileSync("git",["status","--porcelain","--untracked-files=no"],{encoding:"utf8"}).trim(),platform:platform(),os:release(),cpu:cpus()[0].model,logicalCpus:cpus().length,node:process.version,samples:count,recordedAt:new Date().toISOString(),profile,units:"ms",scenarios:{}};
for(const kind of profile?["node"]:["node","gateway"]){report.scenarios[kind]=await scenario(kind,profile);console.log(kind,JSON.stringify(report.scenarios[kind]));}
await writeFile(join(out,profile?"profile-run.json":"http.json"),JSON.stringify(report,null,2));
