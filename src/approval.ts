import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
export default function(pi:ExtensionAPI){
  pi.on('tool_call',async(event,ctx)=>{
    const path=process.env.AXIOM_PERMISSION_FILE;
    const policy=path&&existsSync(path)?JSON.parse(readFileSync(path,'utf8')).mode:'full';
    if(policy==='full')return;
    const allowed=['read','ls','find','grep',...(process.env.AXIOM_TEAM_TOKEN?['team_board','team_send','team_inbox']:[])];
    const mutating=!allowed.includes(event.toolName);
    if(process.env.AXIOM_WORKSPACE_ROOT&&['read','ls','find','grep'].includes(event.toolName)){
      try{const root=realpathSync(process.env.AXIOM_WORKSPACE_ROOT);const input=event.input as {path?:string};const target=realpathSync(resolve(root,input.path||'.'));const rel=relative(root,target);if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))return {block:true,reason:'Read path outside workspace'};}catch{return {block:true,reason:'Invalid or inaccessible workspace path'};}
    }
    if(policy==='read-only'&&mutating)return {block:true,reason:'User enabled read-only mode'};
    if(policy==='ask'&&mutating){
      const yes=await ctx.ui.confirm('Authorize '+event.toolName,JSON.stringify(event.input,null,2).slice(0,6000),{timeout:120000});
      if(!yes)return {block:true,reason:'User denied or did not approve tool execution'};
    }
  });
  pi.registerCommand('axiom-ui-test',{description:'Test the GUI confirmation bridge without calling a model',handler:async(_args,ctx)=>{const yes=await ctx.ui.confirm('Axiom UI test','Confirm that extension dialogs work.',{timeout:30000});ctx.ui.notify(yes?'AXIOM_DIALOG_OK':'AXIOM_DIALOG_CANCELLED','info');}});
}
