import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const {port} = server.address();
  await new Promise((done) => server.close(done));
  return port;
}
async function until(fn, timeout=15000) {
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline) {
    const value=await fn();
    if(value) return value;
    await delay(75);
  }
  throw Error("Condition timed out");
}
async function fixture() {
  const dir=await mkdtemp(join(tmpdir(),"axiom-core-"));
  const workspace=join(dir,"workspace"), sessionDir=join(dir,"sessions"), config=join(dir,"config.json");
  const runtimePort=await freePort(),rustTerminalPort=await freePort();
  const env={...process.env,AXIOM_CONFIG:config,AXIOM_DESKTOP:"1",PI_CODING_AGENT_DIR:join(dir,"pi-agent")};
  await writeFile(config,JSON.stringify({workspace,sessionDir,runtimePort,rustTerminalPort,discoverContext:false}));
  return {dir,workspace,sessionDir,config,runtimePort,env};
}
test("HTTP host: authenticated runtime, restart, extension confirmation and stale response", {timeout:90000}, async()=>{
  const f=await fixture();
  const gateway=process.env.AXIOM_TEST_GATEWAY;
  const root=resolve(process.env.AXIOM_TEST_RUNTIME_ROOT || ".");
  const host=join(root,"src/server.mjs");
  const child=spawn(gateway || process.execPath,gateway?["--gateway",process.execPath,host]:[host],{env:f.env,stdio:["pipe","pipe","pipe"],windowsHide:true});
  const exited=once(child,"exit");
  let stderr="";
  child.stderr.on("data",d=>{stderr+=d;});
  const lines=createInterface({input:child.stdout});
  let base;
  lines.on("line",line=>{if(line.startsWith("AXIOM_READY "))base="http://127.0.0.1:"+line.slice(12);});
  const runtime="http://127.0.0.1:"+f.runtimePort;
  let token, sse;
  const runtimeRequest=(path,options={})=>fetch(runtime+path,{...options,headers:{Authorization:"Bearer "+token,...options.headers},signal:AbortSignal.timeout(5000)});
  const get=async path=>{const res=await fetch(base+"/api/"+path,{signal:AbortSignal.timeout(20000)});assert.ok(res.ok,await res.clone().text());return res.json();};
  const post=(path,body,authorized=true)=>fetch(base+"/api/"+path,{method:"POST",headers:{"Content-Type":"application/json",...(authorized?{Origin:base,"X-Axiom-Client":"1"}:{Origin:"https://example.invalid"})},body:JSON.stringify(body),signal:AbortSignal.timeout(35000)});
  try {
    await until(()=>base,20000);
    token=await readFile(join(f.sessionDir,"runtime.token"),"utf8");
    assert.equal((await get("settings")).permission,"ask");
    const bad = await post("permission",null);
    assert.equal(bad.status,400);
    const requestId = bad.headers.get("x-request-id");
    assert.ok(requestId);
    assert.equal((await bad.json()).requestId,requestId);
    await until(()=>stderr.includes(requestId));
    assert.ok((await get("health")).httpErrors.client >= 1);
    const policyFile = join(f.sessionDir,"permission.json");
    await writeFile(policyFile, "fixture-policy-private-text");
    const damaged = await fetch(base+"/api/settings");
    assert.equal(damaged.status,500);
    const failure = await damaged.json();
    assert.equal(failure.error,"Internal service error");
    assert.equal(failure.requestId,damaged.headers.get("x-request-id"));
    await until(()=>stderr.includes(failure.requestId));
    assert.ok(!stderr.includes("fixture-policy-private-text"));
    assert.ok((await get("health")).httpErrors.server >= 1);
    assert.ok((await post("permission",{mode:"ask"})).ok);
    assert.equal((await get("settings")).permission,"ask");
    const stream = new ReadableStream({start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({text:"测".repeat(60000)})));
      controller.close();
    }});
    const streamed = await fetch(base+"/api/builtin-prompt",{method:"POST",duplex:"half",body:stream,
      headers:{Origin:base,"X-Axiom-Client":"1","Content-Type":"application/json"}});
    assert.equal(streamed.status,413);
    assert.equal((await post("provider-action",{operation:"upsert",name:"axiom-custom-test",envKey:"TEST_KEY",baseUrl:"http://example.invalid"})).status,400);
    const tooLarge = await post("permission",{mode:"x".repeat(2*1024*1024)});
    assert.equal(tooLarge.status,413);
    const initialPrompt = await get("builtin-prompt");
    assert.equal(initialPrompt.text, initialPrompt.defaultText);
    const promptEdit = {text:"Keep the fixture responses brief.",expected:initialPrompt.text};
    assert.equal((await post("builtin-prompt",promptEdit,false)).status,403);
    assert.equal((await post("builtin-prompt",promptEdit)).status,200);
    assert.equal((await get("builtin-prompt")).text,promptEdit.text);
    assert.equal((await post("builtin-prompt",{...promptEdit,text:"stale edit"})).status,400);
    assert.equal((await post("builtin-prompt",{text:"",expected:promptEdit.text})).status,200);
    assert.equal((await get("builtin-prompt")).text,"");
    if(gateway){
      const privatePort=await until(()=>/Axiom Agent http:\/\/127\.0\.0\.1:(\d+)/.exec(stderr)?.[1]);
      assert.notEqual(Number(privatePort),Number(new URL(base).port));
      const bypass=await new Promise((resolve,reject)=>{const req=request("http://127.0.0.1:"+privatePort+"/api/state",{headers:{Host:new URL(base).host,"X-Axiom-Gateway-Secret":"forged"}},res=>{res.resume();resolve(res.statusCode);});req.on("error",reject);req.end();});
      assert.equal(bypass,403);
      const invalidHost=await new Promise((resolve,reject)=>{const req=request(base+"/api/state",{headers:{Host:"example.invalid"}},res=>{res.resume();resolve(res.statusCode);});req.on("error",reject);req.end();});
      assert.equal(invalidHost,403);
      const asset=await fetch(base+"/app.js");assert.ok(asset.ok);assert.match(await asset.text(),/EventSource/);
    }
    const first=await get("runtime-health");
    assert.equal(first.ok,true);
    assert.equal(first.workspace,f.workspace);
    assert.equal(first.sessionDir,f.sessionDir);
    assert.equal((await runtimeRequest("/api/job-action",{method:"POST",body:"null"})).status,400);
    assert.equal((await fetch(runtime+"/api/jobs",{headers:{Authorization:token}})).status,403);
    for(const headers of [{},{Authorization:"Bearer wrong"}]){
      const res=await fetch(runtime+"/api/jobs",{headers,signal:AbortSignal.timeout(5000)});
      assert.equal(res.status,403);
    }
    const badHost=await new Promise((resolve,reject)=>{const req=request(runtime+"/api/jobs",{headers:{Authorization:"Bearer "+token,Host:"example.invalid"}},res=>{res.resume();resolve(res.statusCode);});req.on("error",reject);req.end();});
    assert.equal(badHost,403);
    assert.equal((await runtimeRequest("/api/runtime-health")).status,200);
    assert.equal((await post("job-action",{action:"plan",value:{}},false)).status,403);
    const schedule=await post("job-action",{action:"schedule-create",value:{label:"fixture",steps:["never run"],cron:"0 0 1 1 *",timezone:"UTC"}});
    assert.ok(schedule.ok,await schedule.clone().text());
    const {id}=await schedule.json();
    const stopped=await runtimeRequest("/api/runtime-stop",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
    assert.ok(stopped.ok);
    // Wait for the old process to release its listener before requesting recovery.
    await until(async()=>{try{await runtimeRequest("/api/runtime-health");return false;}catch{return true;}});
    const restarted=await get("runtime-health");
    assert.notEqual(restarted.pid,first.pid);
    assert.ok((await get("jobs")).schedules.some(s=>s.id===id));
    assert.ok((await post("job-action",{action:"schedule-delete",value:{id}})).ok);
    sse=new AbortController();
    const response=await fetch(base+"/api/events",{signal:sse.signal});
    assert.ok(response.ok);
    const events=[];
    const eventTask=(async()=>{
      const reader=response.body.getReader(),decoder=new TextDecoder();
      let buffer="";
      try {
        while (true) {
          const {value,done}=await reader.read();
          if (done) break;
          buffer+=decoder.decode(value,{stream:true});
          let boundary;
          while ((boundary=buffer.indexOf("\n\n"))!==-1) {
            const frame=buffer.slice(0,boundary);
            buffer=buffer.slice(boundary+2);
            if (!frame.startsWith("data: ")) continue;
            const event=JSON.parse(frame.slice(6));
            assert.ok(Number.isSafeInteger(event.seqId));
            if(events.length) assert.equal(event.seqId,events.at(-1).seqId+1);
            events.push(event);
          }
        }
      }
      catch(error){if(!sse.signal.aborted)throw error;}
    })();
    eventTask.catch(()=>{});
    for(const confirmed of [true,false]){
      const pending=post("action",{action:"prompt",value:"/axiom-ui-test"});
      pending.catch(()=>{});
      const dialog=await until(async()=> (await get("dialogs"))[0]);
      assert.equal(dialog.method,"confirm");
      assert.equal((await post("ui-response",{id:dialog.id,confirmed},false)).status,403);
      const reply=await post("ui-response",{id:dialog.id,confirmed});
      assert.ok(reply.ok,await reply.clone().text());
      assert.equal((await post("ui-response",{id:dialog.id,confirmed})).status,400);
      assert.ok((await pending).ok);
      const expected=confirmed?"AXIOM_DIALOG_OK":"AXIOM_DIALOG_CANCELLED";
      await until(()=>events.some(e=>e.type==="extension_ui_request"&&e.method==="notify"&&e.message===expected));
      assert.deepEqual(await get("dialogs"),[]);
    }
    assert.equal((await get("harness")).planMode,false);
    const stalePrompt = await post("action",{action:"prompt",value:"/axiom-plan on",sessionId:"stale-session"});
    assert.equal(stalePrompt.status,400);
    assert.match((await stalePrompt.json()).error,/active session changed/);
    assert.ok((await post("action",{action:"prompt",value:"/axiom-plan on"})).ok);
    assert.equal((await get("harness")).planMode,true);
    const snapshot = await get("snapshot");
    assert.equal(snapshot.state.sessionId,snapshot.harness.sessionId);
    assert.equal(snapshot.harness.planMode,true);
    assert.deepEqual(snapshot.dialogs,[]);
    assert.ok((await post("action",{action:"prompt",value:"/axiom-plan off"})).ok);
    assert.equal((await get("harness")).planMode,false);
    const piDir=join(f.workspace,".pi");
    await mkdir(piDir,{recursive:true});
    const source="npm:axiom-fixture-not-installed";
    const settingsPath=join(piDir,"settings.json");
    const mcpPath=join(piDir,"mcp.json");
    const advanced={source:"npm:advanced-fixture",skills:["selected"]};
    await writeFile(settingsPath,JSON.stringify({packages:[source,advanced]}));
    await writeFile(mcpPath,JSON.stringify({mcpServers:{fixture:{url:"https://example.invalid/mcp"}}}));
    const resource=async body=>{const res=await post("resource-action",body);assert.ok(res.ok,await res.clone().text());};
    await resource({operation:"package-disable",source});
    assert.equal(JSON.parse(await readFile(settingsPath,"utf8")).packages[0].autoload,false);
    assert.equal((await post("resource-action",{operation:"package-disable",source:advanced.source})).status,400);
    await resource({operation:"package-enable",source});
    assert.deepEqual(JSON.parse(await readFile(settingsPath,"utf8")).packages,[source,advanced]);
    await resource({operation:"mcp-toggle",name:"fixture"});
    assert.equal(JSON.parse(await readFile(mcpPath,"utf8")).mcpServers.fixture.enabled,false);
    await resource({operation:"mcp-toggle",name:"fixture"});
    assert.equal(JSON.parse(await readFile(mcpPath,"utf8")).mcpServers.fixture.enabled,true);
    const session = SessionManager.create(f.workspace, f.sessionDir);
    const userEntry = session.appendMessage({role:"user",content:"Pi export fixture",timestamp:Date.now()});
    const branchLeaf = session.appendMessage({
      role:"assistant",content:[{type:"text",text:"Native Pi fixture reply"}],timestamp:Date.now(),
      api:"openai-completions",provider:"fixture",model:"fixture",stopReason:"stop",
      usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},
    });
    session.branch(userEntry);
    const leafId = session.appendMessage({role:"user",content:"Active branch",timestamp:Date.now()});
    const sessionId = session.getSessionId();
    assert.ok((await post("action",{action:"switch",value:sessionId})).ok);
    const {history} = await get("session-details?view=history");
    assert.equal(history.rows.find(row=>row.id===leafId)?.active,true,JSON.stringify(history));
    assert.equal(history.rows.find(row=>row.id===userEntry).active,true);
    assert.equal(history.rows.find(row=>row.id===branchLeaf).active,false);
    assert.equal((await get("session-details?view=last-reply")).text,null);
    assert.equal((await post("session-export",{sessionId},false)).status,403);
    assert.equal((await post("session-export",{sessionId:"different"})).status,400);
    const exported = await post("session-export",{sessionId});
    assert.ok(exported.ok,await exported.clone().text());
    assert.equal(exported.headers.get("content-disposition"),'attachment; filename="pi-session.html"');
    assert.match(await exported.text(), /<title>Session Export<\/title>/);
    assert.ok((await post("action",{action:"clear-queue"})).ok);
    assert.equal((await post("action",{action:"abort-retry"})).status,400);
    assert.ok((await post("action",{action:"cycle-thinking"})).ok);
    const fork = await post("action",{action:"fork",value:leafId});
    assert.ok(fork.ok,await fork.clone().text());
    assert.equal((await fork.json()).text,"Active branch");
    assert.notEqual((await get("state")).sessionId,sessionId);
    sse.abort();await eventTask;
  }finally{
    sse?.abort();
    if(token)try{await runtimeRequest("/api/runtime-stop",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});}catch{}
    child.stdin.end();
    await Promise.race([exited,delay(6000,undefined,{ref:false})]);
    if(child.exitCode===null&&child.signalCode===null){child.kill();await exited;}
    lines.close();
    if(stderr) console.error(stderr);
    await rm(f.dir,{recursive:true,force:true,maxRetries:4,retryDelay:150});
  }
});
test("Agent recovers after real Pi process exit and stalled JSONL request without replay", {timeout:45000}, async()=>{
  const f=await fixture();
  process.env.AXIOM_CONFIG=f.config;
  process.env.PI_CODING_AGENT_DIR=f.env.PI_CODING_AGENT_DIR;
  const {Agent}=await import("../src/agent.mjs");
  const {PiClient}=await import("../src/pi-client.mjs");
  const clients=[];
  const stall=join(f.dir,"stall.mjs");
  await writeFile(stall,'import readline from "node:readline"; let n=0; readline.createInterface({input:process.stdin}).on("line",l=>{const m=JSON.parse(l);if(n++===0) console.log(JSON.stringify({type:"response",id:m.id,success:true,data:{sessionId:"fixture-stall"}}));});');
  const agent=new Agent(options=>{
    const client=clients.length===2 ? new PiClient({...options,cliPath:stall},300) : new PiClient(options);
    clients.push(client);return client;
  });
  const events=[];
  agent.subscribe(e=>events.push(e));
  try{
    await agent.start();
    const first=clients[0], initialPid=first.process.pid;
    const sessionId=(await agent.state()).sessionId;
    const waiting=agent.prompt("/axiom-ui-test");
    waiting.catch(()=>{});
    const dialog=await until(()=>agent.pendingDialogs()[0]);
    first.process.kill();
    await assert.rejects(waiting);
    await until(()=>events.some(e=>e.type==="connection_error"));
    assert.equal(agent.busy,false);
    assert.deepEqual(agent.pendingDialogs(),[]);
    await assert.rejects(agent.respond({id:dialog.id,confirmed:true}),/expired/);
    const state=await agent.state();
    assert.equal(state.workspace,f.workspace);
    assert.equal(clients.length,2);
    assert.notEqual(clients[1].process.pid,initialPid);
    assert.equal(state.sessionId,sessionId);
    clients[1].process.kill();
    await until(()=>clients[1].disconnected);
    await assert.rejects(agent.state(),/Timeout waiting for response/);
    assert.equal(clients[2].pendingRequests.size,0);
    assert.equal((await agent.state()).workspace,f.workspace);
    assert.equal(clients.length,4);
  }finally{
    await agent.close();
    await rm(f.dir,{recursive:true,force:true,maxRetries:4,retryDelay:150});
  }
});
