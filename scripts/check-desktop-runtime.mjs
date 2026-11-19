import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join, delimiter } from 'node:path';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createInterface } from 'node:readline';

const root=resolve('.desktop-runtime'),dir=await mkdtemp(join(tmpdir(),'axiom-desktop-'));
const sessionDir=join(dir,'sessions'),workspace=join(dir,'workspace'),config=join(dir,'config.json');
assert.equal(existsSync(join(root,"node_modules/node-pty")),false,"Legacy production native module");
assert.equal(existsSync(join(root,"src/terminal.mjs")),false,"Legacy production implementation");
const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');
const runtimePort=listener.address().port;await new Promise(resolve=>listener.close(resolve));
const rustListener=createServer();rustListener.listen(0,"127.0.0.1");await once(rustListener,"listening");
const rustTerminalPort=rustListener.address().port;await new Promise(resolve=>rustListener.close(resolve));
await mkdir(workspace);
await writeFile(config,JSON.stringify({workspace,sessionDir,runtimePort,rustTerminalPort,discoverContext:false}));
const node=join(root,'bin','node.exe');
const child=spawn(node,[join(root,'src','server.mjs')],{cwd:root,env:{...process.env,AXIOM_DESKTOP:'1',AXIOM_CONFIG:config,PI_CODING_AGENT_DIR:join(dir,'pi-agent'),PATH:join(root,'bin')+delimiter+process.env.PATH},stdio:['pipe','pipe','inherit'],windowsHide:true});
const exited=once(child,'exit');
const lines=createInterface({input:child.stdout});
let base, terminal;
try{
 const port=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Host readiness timeout')),30000);
  lines.on('line',line=>{const m=/^AXIOM_READY (\d+)$/.exec(line);if(m){clearTimeout(timer);resolve(Number(m[1]));}});
  child.once('exit',code=>{clearTimeout(timer);reject(Error('Host exited: '+code));});
 });
 base='http://127.0.0.1:'+port;
 const get=async path=>{const res=await fetch(base+path,{signal:AbortSignal.timeout(20000)});assert.ok(res.ok,await res.clone().text());return res;};
 const post=async(path,body)=>{const res=await fetch(base+path,{method:'POST',headers:{Origin:base,'X-Axiom-Client':'1','Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});assert.ok(res.ok,await res.clone().text());return res.json();};
 for(const path of ['/','/app.js','/markdown.js','/dsh-ui.js','/workbench.js','/workbench.css'])await get(path);
 const health=await (await get('/api/health')).json();assert.equal(health.ok,true);
 const state=await(await get('/api/state')).json();assert.equal(state.workspace,workspace);
 const runtime=await(await get('/api/runtime-health')).json();assert.equal(runtime.ok,true);assert.equal(runtime.terminalBackend,"rust");
 terminal=await post('/api/terminal-action',{action:'create'});
 const ctrl=new AbortController();
 try{
  const res=await fetch(base+'/api/terminal/events?id='+terminal.id,{signal:ctrl.signal});
  assert.ok(res.ok);
  const reader=res.body.getReader(),decoder=new TextDecoder();
  await post('/api/terminal-action',{action:'input',value:{id:terminal.id,data:"Write-Output ('AXIOM_'+'PACKAGED_PTY_OK')\r"}});
  let data='';const timer=setTimeout(()=>ctrl.abort(),15000);
  try{while(!data.includes('AXIOM_PACKAGED_PTY_OK')){const {value,done}=await reader.read();if(done)break;data+=decoder.decode(value,{stream:true});}assert.match(data,/AXIOM_PACKAGED_PTY_OK/);}
  finally{clearTimeout(timer);}
 }finally{ctrl.abort();}
 await post('/api/terminal-action',{action:'close',value:{id:terminal.id}});terminal=null;
 console.log('PACKAGED_RUNTIME_OK: UI, Pi RPC, Cordis, native PTY');
}finally{
 if(base&&terminal)await fetch(base+'/api/terminal-action',{method:'POST',headers:{Origin:base,'X-Axiom-Client':'1','Content-Type':'application/json'},body:JSON.stringify({action:'close',value:{id:terminal.id}})}).catch(()=>{});
 try{const token=await readFile(join(sessionDir,'runtime.token'),'utf8');await fetch('http://127.0.0.1:'+runtimePort+'/api/runtime-stop',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(3000)});}catch{}
 child.stdin.end();
 await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,5500))]);
 if(child.exitCode===null){child.kill();await exited;}
 lines.close();
 await rm(dir,{recursive:true,force:true});
}
