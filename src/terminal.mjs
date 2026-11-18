import { spawn } from 'node-pty';
import { randomUUID } from 'node:crypto';
import { config } from './config.mjs';
import {resolve} from 'node:path';
import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
const terminals=new Map();
const archive=resolve(config.sessionDir,'terminals.json');
if(existsSync(archive)){for(const item of JSON.parse(readFileSync(archive,'utf8'))){terminals.set(item.id,{...item,pty:null,interrupted:item.exit===null,listeners:new Set()});}}
let dirty=false;function persist(){if(!dirty)return;const records=[...terminals.values()].map(({id,buffer,exit,interrupted})=>({id,buffer,exit,interrupted:Boolean(interrupted)}));writeFileSync(archive+'.tmp',JSON.stringify(records));renameSync(archive+'.tmp',archive);dirty=false;}
const checkpoint=setInterval(persist,1000);checkpoint.unref();
export function createTerminal(){
  if(terminals.size>=8)throw Error('Close unused terminals before opening another');
  const shell=process.env.AXIOM_PWSH_EXE||(process.platform==='win32'?resolve(process.env.ProgramFiles||'C:/Program Files','PowerShell/7/pwsh.exe'):'pwsh');
  if(process.platform==='win32'&&!existsSync(shell))throw Error('PowerShell 7 executable not found; set AXIOM_PWSH_EXE');
  const id=randomUUID(),pty=spawn(shell,['-NoLogo','-NoProfile'],{name:'xterm-256color',cols:80,rows:24,cwd:config.workspace,env:{...process.env,TERM:'xterm-256color'}});
  const terminal={id,pty,buffer:'',listeners:new Set(),exit:null};
  terminals.set(id,terminal);dirty=true;persist();
  pty.onData(data=>{terminal.buffer=(terminal.buffer+data).slice(-262144);dirty=true;for(const fn of terminal.listeners)fn({data});});
  pty.onExit(({exitCode})=>{terminal.exit=exitCode;dirty=true;persist();for(const fn of terminal.listeners)fn({exit:exitCode});});
  return {id};
}
export function getTerminal(id){const t=terminals.get(id);if(!t)throw Error('Unknown terminal');return t;}
export function terminalAction(action, value){
  if(action==='create')return createTerminal();
  const t=getTerminal(value.id);
  if(action==='close'){if(t.pty&&t.exit===null)t.pty.kill();terminals.delete(t.id);dirty=true;persist();for(const fn of t.listeners)fn({closed:true});return {ok:true};}
  if(!t.pty||t.exit!==null)throw Error('Terminal is archived or exited');
  if(action==='input'){if(typeof value.data!=='string'||value.data.length>65536)throw Error('Invalid terminal input');t.pty.write(value.data);}
  else if(action==='resize'){const {cols,rows}=value;if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<2||rows<2||cols>500||rows>200)throw Error('Invalid terminal dimensions');t.pty.resize(cols,rows);}
  else throw Error('Unknown terminal action');
  return {ok:true};
}
export function closeTerminals(){for(const t of terminals.values())if(t.pty&&t.exit===null){t.interrupted=true;t.pty.kill();}dirty=true;persist();clearInterval(checkpoint);}



export function listTerminals(){return [...terminals.values()].map(t=>({id:t.id,exit:t.exit,interrupted:Boolean(t.interrupted)}));}
