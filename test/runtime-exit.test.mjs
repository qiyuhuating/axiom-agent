import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
async function port() {
  const s=createServer();
  s.listen(0,"127.0.0.1");
  await once(s,"listening");
  const {port}=s.address();
  await new Promise(resolve=>s.close(resolve));
  return port;
}
async function until(fn,timeout=15000) {
  const end=Date.now()+timeout;
  while(Date.now()<end){const result=await fn();if(result)return result;await delay(100);}
  throw Error("Timed out");
}
test("desktop exits owned idle runtime, but not an already running independent runtime", {timeout:60000}, async()=>{
  const root=resolve(process.env.AXIOM_TEST_RUNTIME_ROOT || ".");
  const gateway=process.env.AXIOM_TEST_GATEWAY;
  const dir=await mkdtemp(join(tmpdir(),"axiom-runtime-exit-"));
  const config=join(dir,"config.json"), sessionDir=join(dir,"sessions");
  const runtimePort=await port(), rustTerminalPort=await port();
  await writeFile(config,JSON.stringify({workspace:join(dir,"workspace"),sessionDir,runtimePort,rustTerminalPort,terminalBackend:gateway?"rust":"node",discoverContext:false}));
  const env={...process.env,AXIOM_CONFIG:config,AXIOM_DESKTOP:"1",PI_CODING_AGENT_DIR:join(dir,"pi-agent")};
  const runtime="http://127.0.0.1:"+runtimePort;
  const children=[];
  let token;
  async function host(){
    const node=gateway?join(root,"bin","node.exe"):process.execPath;
    const child=spawn(gateway || node,gateway?["--gateway",node,join(root,"src/server.mjs")]:[join(root,"src/server.mjs")],{env,cwd:root,stdio:["pipe","pipe","pipe"],windowsHide:true});
    children.push(child);
    let base, error="";
    const lines=createInterface({input:child.stdout});
    child.stderr.on("data",chunk=>{error+=chunk;});
    lines.on("line",line=>{if(line.startsWith("AXIOM_READY "))base="http://127.0.0.1:"+line.slice(12);});
    await until(()=>{if(child.exitCode!==null)throw Error("Host exited "+child.exitCode+": "+error);return base;},25000).catch(e=>{throw Error(e.message+"\n"+error)});
    const ready=await fetch(base+"/api/runtime-health",{signal:AbortSignal.timeout(15000)});
    assert.ok(ready.ok,await ready.clone().text());
    token=await readFile(join(sessionDir,"runtime.token"),"utf8");
    return {child,base,pid:(await ready.json()).pid,error:()=>error};
  }
  async function close(host){
    const exit=once(host.child,"exit");
    host.child.stdin.end();
    const [code]=await exit;
    assert.equal(code,0,host.error());
  }
  const request=(path,body)=>fetch(runtime+path,{method:body===undefined?"GET":"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(3000)});
  const alive=async()=>{try{return (await request("/api/runtime-health")).ok;}catch{return false;}};
  try{
    const first=await host();
    const second=await host();
    assert.equal(first.pid,second.pid);
    await close(second);
    assert.equal(await alive(),true);
    const unauthorized=await request("/api/runtime-stop-idle",{owner:"not-the-owner"});
    assert.deepEqual(await unauthorized.json(),{stopping:false});
    await close(first);
    await until(async()=>!(await alive()));
    await until(()=>{try{process.kill(first.pid,0);return false;}catch(e){return e.code==="ESRCH";}});
    const third=await host();
    const create=await request("/api/terminal-action",{action:"create"});
    assert.ok(create.ok,await create.clone().text());
    const {id}=await create.json();
    await close(third);
    assert.equal(await alive(),true);
    const terminals=await (await request("/api/terminals")).json();
    assert.ok(terminals.some(t=>t.id===id && t.exit===null));
    assert.ok((await request("/api/terminal-action",{action:"close",value:{id}})).ok);
    assert.ok((await request("/api/runtime-stop",{})).ok);
    await until(()=>{try{process.kill(third.pid,0);return false;}catch(e){return e.code==="ESRCH";}});
  }finally{
    if(token)try{await request("/api/runtime-stop",{});}catch{}
    for(const child of children)if(child.exitCode===null){const exit=once(child,"exit");child.kill();await exit;}
    await rm(dir,{recursive:true,force:true,maxRetries:8,retryDelay:250});
  }
});
