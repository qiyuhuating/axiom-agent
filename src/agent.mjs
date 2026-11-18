import { SessionManager } from '@earendil-works/pi-coding-agent';
import { resolve, dirname } from 'node:path';
import { unlink } from 'node:fs/promises';
import { config, root } from './config.mjs';
import { PiClient } from './pi-client.mjs';

export class Agent {
  #client;
  #listeners = new Set();
  #busy = false;
  #startup;
  #changing = false;
  #dialogs = new Map();
  get busy() { return this.#busy; }
  async start() {
    this.#startup ??= this.#init();
    return this.#startup;
  }
  async #init() {
    const client = this.#client = new PiClient({
      cliPath: resolve(root, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'),
      cwd: config.workspace,
      provider: config.provider, model: config.model,
      args: ['--session-dir', config.sessionDir, '--continue', ...(!config.discoverContext ? ['--no-context-files'] : []), ...(config.maxOutputTokens ? ['--extension', resolve(root, 'src/output-budget.ts')] : []), '--extension', resolve(root, 'src/approval.ts'), '--extension', resolve(root, 'src/providers.ts')], env: { AXIOM_MAX_OUTPUT_TOKENS: String(config.maxOutputTokens ?? ''), AXIOM_PROVIDER_FILE: resolve(config.sessionDir,'axiom-providers.json'), AXIOM_PERMISSION_FILE: resolve(config.sessionDir,'permission.json') }
    });
    client.onEvent(event => {
      if (event.type === 'extension_ui_request' && ['select','confirm','input','editor'].includes(event.method)) {
        this.#dialogs.set(event.id,event);
        if(event.timeout) setTimeout(()=>{if(this.#dialogs.delete(event.id))this.#emit({type:'ui_closed',id:event.id});},event.timeout).unref();
      }
      if(event.type==='agent_settled'){ for(const id of this.#dialogs.keys())this.#emit({type:'ui_closed',id}); this.#dialogs.clear(); }
      if (event.type === 'agent_start') this.#busy = true;
      if (event.type === 'agent_settled') this.#busy = false;
      this.#emit({ ...event, busy: this.#busy });
    });
    await client.start();
    await client.getState();
  }
  #emit(event) { for (const listener of this.#listeners) listener(event); }
  subscribe(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  async state() {
    await this.start();
    const state = await this.#client.getState();
    return { model: state.model && { provider: state.model.provider, id: state.model.id }, thinkingLevel: state.thinkingLevel, busy: this.#busy, sessionId: state.sessionId, workspace: config.workspace };
  }
  async messages() { await this.start(); return (await this.#client.getMessages()).filter(m => m.role !== "system"); }
  async models() { await this.start(); return this.#client.getAvailableModels(); }
  async levels() { await this.start(); return this.#client.getAvailableThinkingLevels(); }
  async sessions() {
    const list = await SessionManager.list(config.workspace, config.sessionDir);
    return list.map(({ id, name, firstMessage, modified }) => ({ id, name, firstMessage, modified }));
  }
  async prompt(message,images) {
    await this.start();
    if (this.#busy || this.#changing) throw new Error('Agent is running or changing session.');
    this.#busy = true;
    this.#emit({ type: 'run_status', busy: true });
    try {
      const disposition = await this.#client.prompt(message,images);
      if (disposition === 'handled') { this.#busy = false; this.#emit({ type: 'run_status', busy: false }); }
      return { disposition };
    } catch (error) {
      this.#busy = false; this.#emit({ type: 'run_status', busy: false }); throw error;
    }
  }
  async steer(message,images) { await this.start(); if (this.#changing) throw new Error('Session change in progress.'); return this.#client.steer(message,images); }
  async followUp(message,images){await this.start();if(this.#changing)throw Error('Session change in progress');return this.#client.followUp(message,images);}
  async clearQueue(){await this.start();return this.#client.clearQueue();}
  async sessionDetails(){await this.start();const [stats,forks,tree]=await Promise.all([this.#client.getSessionStats(),this.#client.getForkMessages(),this.#client.getTree()]);return {stats,forks,tree};}
  async abort() { await this.start(); if (this.#changing) throw new Error('Session change in progress.'); await this.#client.abort(); this.#busy = false; this.#emit({ type: 'run_status', busy: false }); }
  async change(action, value) {
    await this.start();
    if (this.#busy || this.#changing) throw new Error('Stop current run or wait for the session change.');
    this.#changing = true;
    try {
      if (action === 'new') return await this.#client.newSession();
      if (action === 'switch' || action === 'delete') {
        const list = await SessionManager.list(config.workspace, config.sessionDir);
        const entry = list.find(s => s.id === value);
        if (!entry) throw new Error('Session not found or already deleted.');
        if (action === 'switch') return await this.#client.switchSession(entry.path);
        const path = resolve(entry.path);
        if (dirname(path) !== resolve(config.sessionDir) || !path.endsWith('.jsonl')) throw new Error('Invalid session path.');
        const state = await this.#client.getState();
        if (state.sessionId === entry.id) {
          const result = await this.#client.newSession();
          if (result.cancelled || (await this.#client.getState()).sessionId === entry.id) {
            throw new Error('Pi refused to close the active session.');
          }
        }
        await unlink(path);
        return { deleted: entry.id };
      }
      if(action==='rename'){if(typeof value!=='string'||!value.trim()||value.length>200)throw Error('Invalid session name');await this.#client.setSessionName(value.trim());return {ok:true};}
      if(action==='clone')return this.#client.clone();
      if(action==='fork'){if(!(await this.#client.getForkMessages()).some(m=>m.entryId===value))throw Error('Unknown fork entry');return this.#client.fork(value);}
      if(action==='compact')return this.#client.compact(typeof value==='string'?value:undefined);
      if(action==='auto-compaction'||action==='auto-retry'){if(typeof value!=='boolean')throw Error('Boolean required');await (action==='auto-compaction'?this.#client.setAutoCompaction(value):this.#client.setAutoRetry(value));return {ok:true};}
      if(action==='steering-mode'||action==='follow-up-mode'){if(!['all','one-at-a-time'].includes(value))throw Error('Invalid queue mode');await (action==='steering-mode'?this.#client.setSteeringMode(value):this.#client.setFollowUpMode(value));return {ok:true};}
      if (action === 'model') return await this.#client.setModel(value.provider, value.id);
      if (action === 'thinking') return await this.#client.setThinkingLevel(value);
      throw new Error('Unknown action');
    } finally {
      this.#changing = false;
      if (['new','switch','delete','model','thinking','rename','clone','fork','compact','auto-compaction','auto-retry','steering-mode','follow-up-mode'].includes(action)) this.#emit({ type: 'state_changed', busy: this.#busy });
    }
  }
  async commands(){await this.start();return this.#client.getCommands();}
  pendingDialogs(){return [...this.#dialogs.values()];}
  async respond({id,value,confirmed,cancelled}){
    const dialog=this.#dialogs.get(id);
    if(!dialog)throw Error('Interaction expired or already answered');
    if(!cancelled){
      if(dialog.method==='confirm'&&typeof confirmed!=='boolean')throw Error('Confirmation required');
      if(dialog.method==='select'&&!dialog.options?.includes(value))throw Error('Invalid selection');
      if(['input','editor'].includes(dialog.method)&&typeof value!=='string')throw Error('Text required');
    }
    this.#dialogs.delete(id);
    try{await this.#client.respond({type:'extension_ui_response',id,...(cancelled?{cancelled:true}:dialog.method==='confirm'?{confirmed}:{value})});}
    catch(error){this.#dialogs.set(id,dialog);throw error;}
    this.#emit({type:'ui_closed',id});
    return {ok:true};
  }
  async close() { if (this.#client) await this.#client.stop(); }
}
