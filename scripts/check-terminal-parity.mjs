import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createInterface } from "node:readline";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const runtimeRoot=resolve(process.env.AXIOM_TEST_RUNTIME_ROOT || ".");
const daemon=resolve(process.env.AXIOM_TEST_DAEMON || ("daemon/target/debug/axiom-daemon"+(process.platform==="win32"?".exe":"")));

async function port(){
  const server=createServer();server.listen(0,"127.0.0.1");await once(server,"listening");
  const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value;
}

async function launch(backend,fixture){
  const p=await port();
  const rustTerminalPort=backend==="rust-bridge"?await port():undefined;
  await writeFile(fixture.config,JSON.stringify({workspace:fixture.workspace,sessionDir:fixture.dir,runtimePort:p,discoverContext:false,...(backend==="rust-bridge"?{terminalBackend:"rust",rustTerminalPort,rustTerminalBinary:daemon}:{})}));
  const child=backend==="rust"
    ? spawn(daemon,[String(p),fixture.workspace,fixture.dir],{stdio:["ignore","pipe","pipe"],windowsHide:true})
    : spawn(process.execPath,[join(runtimeRoot,"src/runtime.mjs")],{env:{...process.env,AXIOM_CONFIG:fixture.config,PI_CODING_AGENT_DIR:join(fixture.dir,"pi-agent")},stdio:["ignore","pipe","pipe"],windowsHide:true});
  const exited=once(child,"exit");
  let stderr="";
  child.stdout.resume();child.stderr.on("data",d=>{stderr+=d;});
  const base="http://127.0.0.1:"+p;
  const api=(path,body,token=fixture.token)=>fetch(base+"/api/"+path,{
    headers:{Authorization:"Bearer "+token,...(body===undefined?{}:{"Content-Type":"application/json"})},
    method:body===undefined?"GET":"POST",body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)
  });
  async function stop(){
    if(child.exitCode===null&&child.signalCode===null){
      try{await api("runtime-stop",{});}catch{}
      await Promise.race([exited,delay(7000,undefined,{ref:false})]);
      if(child.exitCode===null&&child.signalCode===null){child.kill();await exited;throw Error(backend+" failed graceful shutdown: "+stderr);}
    }
  }
  try{
    for(let i=0;i<100;i++){
      if(child.exitCode!==null||child.signalCode!==null)throw Error(backend+" exited: "+stderr);
      try{const r=await api("runtime-health");if(r.ok){assert.equal((await r.json()).ok,true);return {base,api,stop};}}catch{}
      await delay(75);
    }
    throw Error(backend+" startup timeout: "+stderr);
  }catch(e){await stop();throw e;}
}

async function receive(instance,id,token,predicate,trigger,answerCursor=false){
  const ctrl=new AbortController();
  const timeout=setTimeout(()=>ctrl.abort(),20000);
  try{
    const r=await fetch(instance.base+"/api/terminal/events?id="+id,{headers:{Authorization:"Bearer "+token},signal:ctrl.signal});
    if(!r.ok)throw Error(await r.text());
    await trigger?.();
    const reader=r.body.getReader(),decoder=new TextDecoder();
    let pending="",output="",cursorAnswered=false;
    for(;;){
      const {done,value}=await reader.read();
      if(done)throw Error("PTY stream ended before expected event");
      pending+=decoder.decode(value,{stream:true}).replace(/\r\n/g,"\n");
      let i;
      while((i=pending.indexOf("\n\n"))>=0){
        const frame=pending.slice(0,i);pending=pending.slice(i+2);
        const line=frame.split("\n").find(x=>x.startsWith("data: "));
        if(!line)continue;
        const e=JSON.parse(line.slice(6));
        if(e.data)output+=e.data;
        if(answerCursor&&!cursorAnswered&&output.includes("\x1b[6n")){cursorAnswered=true;const response=await instance.api("terminal-action",{action:"input",value:{id,data:"\x1b[1;1R"}}); assert.ok(response.ok); }
        if(predicate(e,output))return e;
      }
    }
  }finally{clearTimeout(timeout);ctrl.abort();}
}

for(const backend of ["node","rust","rust-bridge"]){
  test(backend+" terminal contract: auth, create, resize, input, reconnect, restart history, close",{timeout:90000},async()=>{
    const dir=await mkdtemp(join(tmpdir(),"axiom-pty-"+backend+"-"));
    const fixture={dir,workspace:join(dir,"workspace"),config:join(dir,"config.json"),token:randomBytes(32).toString("hex")};
    await mkdir(fixture.workspace);await writeFile(join(dir,"runtime.token"),fixture.token);
    let instance;
    try{
      instance=await launch(backend,fixture);
      assert.equal((await instance.api("terminals",undefined,"wrong")).status,403);
      assert.equal(await new Promise((resolve,reject)=>{const req=request(instance.base+"/api/terminals",{headers:{Authorization:"Bearer "+fixture.token,Host:"example.invalid"}},res=>{res.resume();resolve(res.statusCode);});req.on("error",reject);req.end();}),403);
      const act=async(action,value)=>instance.api("terminal-action",{action,value});
      const created=await act("create");assert.ok(created.ok,await created.clone().text());const {id}=await created.json();
      assert.ok(id);
      assert.equal((await act("resize",{id,cols:0,rows:30})).status,400);
      assert.ok((await act("resize",{id,cols:100,rows:30})).ok);
      await receive(instance,id,fixture.token,(_e,output)=>/PS [^\r\n]*>/.test(output),undefined,true);
      if(backend==="rust-bridge")assert.ok(Array.isArray((await (await instance.api("jobs")).json()).jobs));
      const marker="AXIOM_NATIVE_PTY_527";
      await receive(instance,id,fixture.token,(_e,output)=>output.includes(marker),async()=>{
        const r=await act("input",{id,data:"Write-Output ('AXIOM_'+'NATIVE_PTY_'+'527')\r"});assert.ok(r.ok,await r.clone().text());
      });
      const snapshot=await receive(instance,id,fixture.token,e=>e.snapshot===true);
      assert.ok(snapshot.data.includes(marker));assert.equal(snapshot.exit,null);
      assert.equal((await (await instance.api("terminals")).json()).filter(t=>t.id===id).length,1);
      await instance.stop();instance=await launch(backend,fixture);
      const recovered=await receive(instance,id,fixture.token,e=>e.snapshot===true);
      assert.ok(recovered.data.includes(marker));assert.equal(recovered.interrupted,true);
      assert.equal((await act("input",{id,data:"bad"})).status,400);
      assert.ok((await act("close",{id})).ok);
      assert.equal((await (await instance.api("terminals")).json()).length,0);
    }finally{try{await instance?.stop();}finally{await rm(dir,{recursive:true,force:true,maxRetries:8,retryDelay:200});}}
  });
}

test("workbench routes Rust terminal and preserves live session across host restart", {timeout:90000}, async()=>{
  const dir=await mkdtemp(join(tmpdir(),"axiom-rust-web-"));
  const workspace=join(dir,"workspace"),sessionDir=join(dir,"sessions"),config=join(dir,"config.json");
  const runtimePort=await port(),rustTerminalPort=await port();
  await mkdir(workspace);
  await mkdir(sessionDir);
  const token=randomBytes(32).toString("hex");
  await writeFile(join(sessionDir,"runtime.token"),token);
  await writeFile(config,JSON.stringify({workspace,sessionDir,runtimePort,rustTerminalPort,terminalBackend:"rust",rustTerminalBinary:daemon,discoverContext:false}));
  let host;
  async function startHost(){
    const child=spawn(process.execPath,[join(runtimeRoot,"src/server.mjs")],{
      env:{...process.env,AXIOM_CONFIG:config,AXIOM_DESKTOP:"1",PI_CODING_AGENT_DIR:join(dir,"pi-agent")},
      stdio:["pipe","pipe","pipe"],windowsHide:true
    });
    const exit=once(child,"exit");
    let stderr="";child.stderr.on("data",d=>{stderr+=d;});
    const lines=createInterface({input:child.stdout});
    async function stop(){
      child.stdin.end();
      await Promise.race([exit,delay(7000,undefined,{ref:false})]);
      if(child.exitCode===null&&child.signalCode===null){child.kill();await exit;throw Error("Web host failed to close: "+stderr);}
      lines.close();
    }
    try{
      const p=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error("Web host startup timeout")),15000);
        lines.on("line",line=>{if(line.startsWith("AXIOM_READY ")){clearTimeout(timer);resolve(Number(line.slice(12)));}});
        child.once("exit",code=>{clearTimeout(timer);reject(Error("Web host exited: "+code+" "+stderr));});
      });
      const base="http://127.0.0.1:"+p;
      const api=(path,body)=>fetch(base+"/api/"+path,{
        headers:{...(body===undefined?{}:{Origin:base,"X-Axiom-Client":"1","Content-Type":"application/json"})},
        method:body===undefined?"GET":"POST",body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)
      });
      const health=await api("runtime-health");
      assert.ok(health.ok,await health.clone().text());
      return {base,api,stop};
    }catch(e){await stop();throw e;}
  }
  function directHealth(port){return fetch("http://127.0.0.1:"+port+"/api/runtime-health",{
    headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(5000)
  }).then(async r=>{assert.ok(r.ok);return r.json();});}
  try{
    host=await startHost();
    const [nodeHealth,rustHealth]=await Promise.all([directHealth(runtimePort),directHealth(rustTerminalPort)]);
    assert.equal(rustHealth.backend,"rust-pty");
    const wrong=await fetch(host.base+"/api/terminal-action",{method:"POST",headers:{Origin:"https://example.invalid","Content-Type":"application/json","X-Axiom-Client":"1"},body:JSON.stringify({action:"create"})});
    assert.equal(wrong.status,403);
    const created=await host.api("terminal-action",{action:"create"});
    assert.ok(created.ok,await created.clone().text());
    const {id}=await created.json();
    await receive(host,id,token,(_e,output)=>/PS [^\r\n]*>/.test(output),undefined,true);
    const cmd=(suffix)=>host.api("terminal-action",{action:"input",value:{id,data:"Write-Output ('AXIOM_'+'WEB_"+suffix+"')\r"}});
    await receive(host,id,token,(_e,output)=>output.includes("AXIOM_WEB_BEFORE"),async()=>assert.ok((await cmd("BEFORE")).ok));
    await host.stop();
    host=await startHost();
    assert.equal((await directHealth(runtimePort)).pid,nodeHealth.pid);
    assert.equal((await directHealth(rustTerminalPort)).pid,rustHealth.pid);
    const snapshot=await receive(host,id,token,e=>e.snapshot===true);
    assert.ok(snapshot.data.includes("AXIOM_WEB_BEFORE"));
    assert.equal(snapshot.exit,null);
    await receive(host,id,token,(_e,output)=>output.includes("AXIOM_WEB_AFTER"),async()=>assert.ok((await cmd("AFTER")).ok));
    assert.ok((await host.api("terminal-action",{action:"close",value:{id}})).ok);
    assert.equal((await (await host.api("terminals")).json()).length,0);
  }finally{
    try{
      await fetch("http://127.0.0.1:"+runtimePort+"/api/runtime-stop",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(5000)});
      for(let i=0;i<40;i++){try{await directHealth(runtimePort);}catch{break;}await delay(100);}
    }catch{}
    try{await host?.stop();}finally{await rm(dir,{recursive:true,force:true,maxRetries:8,retryDelay:200});}
  }
});
