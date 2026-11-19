import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  await writeFile(fixture.config,JSON.stringify({workspace:fixture.workspace,sessionDir:fixture.dir,runtimePort:p,discoverContext:false,...(backend==="rust-bridge"?{terminalBackend:"rust",rustTerminalPort,rustTerminalBinary:daemon,importLegacyTerminalHistory:fixture.importLegacy===true}:{})}));
  const child=backend==="rust"
    ? spawn(daemon,[String(p),fixture.workspace,fixture.dir,...(fixture.importLegacy?["--import-legacy"]:[])],{stdio:["ignore","pipe","pipe"],windowsHide:true})
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
      try{const r=await api("runtime-health");if(r.ok){assert.equal((await r.json()).ok,true);return {base,api,stop,kill:async()=>{child.kill();await exited;}};}}catch{}
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
      if(backend!=="node")assert.ok(!snapshot.data.startsWith("\x1b[6n"),"Initial ConPTY cursor query must not enter replay history");
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
test("offline legacy terminal history imports exactly once without modifying original", {timeout:90000}, async()=>{
  const dir=await mkdtemp(join(tmpdir(),"axiom-pty-migrate-"));
  const fixture={dir,workspace:join(dir,"workspace"),config:join(dir,"config.json"),token:randomBytes(32).toString("hex")};
  await mkdir(fixture.workspace);
  await writeFile(join(dir,"runtime.token"),fixture.token);
  let instance;
  try{
    instance=await launch("node",fixture);
    const created=await instance.api("terminal-action",{action:"create"});
    assert.ok(created.ok,await created.clone().text());
    const {id}=await created.json();
    await receive(instance,id,fixture.token,(_e,output)=>/PS [^\r\n]*>/.test(output),undefined,true);
    await receive(instance,id,fixture.token,(_e,output)=>output.includes("AXIOM_LEGACY_HISTORY"),async()=>{
      assert.ok((await instance.api("terminal-action",{action:"input",value:{id,data:"Write-Output ('AXIOM_'+'LEGACY_HISTORY')\r"}})).ok);
    });
    await instance.stop();instance=undefined;
    const old=await readFile(join(dir,"terminals.json"));
    const records=JSON.parse(old);
    assert.equal(records.length,1);
    fixture.importLegacy=true;
    instance=await launch("rust-bridge",fixture);
    const snapshot=await receive(instance,id,fixture.token,e=>e.snapshot===true);
    assert.equal(snapshot.data,records[0].buffer);
    assert.equal(snapshot.interrupted,true);
    assert.ok((await instance.api("terminal-action",{action:"close",value:{id}})).ok);
    await instance.stop();instance=undefined;
    instance=await launch("rust-bridge",fixture);
    assert.deepEqual(await (await instance.api("terminals")).json(),[]);
    assert.deepEqual(await readFile(join(dir,"terminals.json")),old);
  }finally{try{await instance?.stop();}finally{await rm(dir,{recursive:true,force:true,maxRetries:8,retryDelay:200});}}
});

test("Windows terminal job kills descendants on close and daemon crash", {timeout:90000,skip:process.platform!=="win32"}, async()=>{
  const dir=await mkdtemp(join(tmpdir(),"axiom-pty-tree-"));
  const fixture={dir,workspace:join(dir,"workspace"),config:join(dir,"config.json"),token:randomBytes(32).toString("hex")};
  await mkdir(fixture.workspace);await writeFile(join(dir,"runtime.token"),fixture.token);
  let instance;
  async function gone(pid){
    for(let i=0;i<100;i++){
      try{process.kill(pid,0);}catch(e){if(e.code==="ESRCH")return;throw e;}
      await delay(100);
    }
    assert.fail("Terminal descendant still running: "+pid);
  }
  try{
    for(const mode of ["close","crash","stop"]){
      instance=await launch("rust",fixture);
      const {id}=await(await instance.api("terminal-action",{action:"create"})).json();
      await receive(instance,id,fixture.token,(_e,out)=>/PS [^\r\n]*>/.test(out));

      const pidFile=join(fixture.workspace,mode+".pid");
      const grandchildFile=join(fixture.workspace,mode+"-grandchild.pid");
      const psQuote=value=>"'"+value.replaceAll("'","''")+"'";
      const nested="$p=Start-Process -FilePath (Get-Process -Id $PID).Path -WindowStyle Hidden -ArgumentList @('-NoProfile','-Command','Start-Sleep -Seconds 120') -PassThru; Set-Content -LiteralPath "+psQuote(grandchildFile)+" -Value $p.Id; Start-Sleep -Seconds 120";
      const encoded=Buffer.from(nested,"utf16le").toString("base64");
      const cmd="$p=Start-Process -FilePath (Get-Process -Id $PID).Path -WindowStyle Hidden -ArgumentList @('-NoProfile','-EncodedCommand','"+encoded+"') -PassThru; Set-Content -LiteralPath "+psQuote(pidFile)+" -Value $p.Id; Write-Output ('AXIOM_'+'CHILD_READY')\r";
      await receive(instance,id,fixture.token,(_e,out)=>out.includes("AXIOM_CHILD_READY"),async()=>assert.ok((await instance.api("terminal-action",{action:"input",value:{id,data:cmd}})).ok));
      const pid=Number((await readFile(pidFile,"utf8")).trim());assert.ok(pid>0);process.kill(pid,0);
      let grandchild;
      for(let i=0;i<100;i++){
        try{grandchild=Number((await readFile(grandchildFile,"utf8")).trim());if(grandchild>0)break;}catch(e){if(e.code!=="ENOENT")throw e;}
        await delay(100);
      }
      assert.ok(grandchild>0);process.kill(grandchild,0);
      if(mode==="close"){assert.ok((await instance.api("terminal-action",{action:"close",value:{id}})).ok);await instance.stop();}
      else if(mode==="crash"){await instance.kill();}
      else {await instance.stop();}
      await Promise.all([gone(pid),gone(grandchild)]);
      instance=undefined;
    }
  }finally{try{await instance?.stop();}finally{await rm(dir,{recursive:true,force:true,maxRetries:8,retryDelay:200});}}
});

test("real Cordis plugin retains synchronous create/list/get/action and live listeners", {timeout:90000}, async()=>{
  const dir=await mkdtemp(join(tmpdir(),"axiom-cordis-terminal-"));
  const fixture={dir,workspace:join(dir,"workspace"),config:join(dir,"config.json"),token:randomBytes(32).toString("hex")};
  await mkdir(fixture.workspace);await writeFile(join(dir,"runtime.token"),fixture.token);
  await writeFile(join(dir,"fixture-terminal.mjs"),await readFile(resolve("scripts/fixtures/cordis-terminal.mjs")));
  await writeFile(join(dir,"cordis.json"),JSON.stringify([{id:"terminal-fixture",name:"./fixture-terminal.mjs",config:{}}]));
  let instance;
  try{
    instance=await launch("rust-bridge",fixture);
    const resultPath=join(dir,"terminal-plugin-result.json");
    let result;
    for(let i=0;i<200;i++){
      try{result=JSON.parse(await readFile(resultPath,"utf8"));break;}catch(e){if(e.code!=="ENOENT")throw e;}
      await delay(100);
    }
    assert.deepEqual(result,{ok:true},result?.error||"Plugin did not finish");
  }finally{try{await instance?.stop();}finally{await rm(dir,{recursive:true,force:true,maxRetries:8,retryDelay:200});}}
});
