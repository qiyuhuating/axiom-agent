import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {resolve} from 'node:path';
import {openSync,closeSync} from 'node:fs';
import {config,root} from './config.mjs';
import {runtimeToken,runtimeUrl} from './runtime-auth.mjs';
const auth={Authorization:'Bearer '+runtimeToken};
async function health(){try{const r=await fetch(runtimeUrl+'/api/runtime-health',{headers:auth,signal:AbortSignal.timeout(1000)});if(!r.ok)return false;const h=await r.json();return h.ok&&h.protocol===1;}catch{return false;}}
let starting;
export async function ensureRuntime(){
 if(await health())return;
 if(!starting)starting=(async()=>{
  const fd=openSync(resolve(config.sessionDir,'runtime.log'),'a');
  const child=spawn(process.execPath,[resolve(root,'src/runtime.mjs')],{cwd:root,env:process.env,detached:true,windowsHide:true,stdio:['ignore',fd,fd]});
  closeSync(fd);child.on('error',e=>console.error('Runtime launch:',e.message));child.unref();
  for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,250));if(await health())return;}
  throw Error('Independent runtime unavailable; inspect runtime.log');
 })().finally(()=>{starting=undefined;});
 return starting;
}
export async function proxyRuntime(req,res,body){
 await ensureRuntime();
 const abort=new AbortController();const onClose=()=>abort.abort();res.on('close',onClose);
 try{
  const r=await fetch(runtimeUrl+req.url,{method:req.method,headers:{...auth,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:abort.signal});
  res.writeHead(r.status,{'Content-Type':r.headers.get('content-type')||'application/json','Cache-Control':'no-store'});
  if(r.body)await pipeline(Readable.fromWeb(r.body),res);else res.end();
 }finally{res.off('close',onClose);}
}
