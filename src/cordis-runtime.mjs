import {Context,Service} from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Include from '@deepseek-ai/cordis-plugin-include';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {config,root} from './config.mjs';
export async function createRuntimeContext(jobs,terminal){
 const ctx=new Context();
 class JobService extends Service {
  constructor(ctx){super(ctx,'axiomJobs');}
  state(){return jobs.jobState();}
  action(action,value){return jobs.jobAction(action,value);}
  teamTool(token,value){return jobs.teamTool(token,value);}
 }
 class TerminalService extends Service {
  constructor(ctx){super(ctx,'axiomTerminal');}
  list(){return terminal.listTerminals();}
  get(id){return terminal.getTerminal(id);}
  action(action,value){return terminal.terminalAction(action,value);}
 }
 await ctx.plugin(JobService);
 await ctx.plugin(TerminalService);
 await ctx.plugin(Loader,{baseUrl:pathToFileURL(resolve(root,'package.json')).href});
 await ctx.plugin(Include,{path:pathToFileURL(resolve(config.sessionDir,'cordis.json')).href,initial:[],enableLogs:true});
 await ctx.loader.await();
 ctx.emit('axiom/runtime-ready');
 return ctx;
}
