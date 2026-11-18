import {test} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';

test('delete inactive and active Pi sessions without deleting workspace files', {timeout:45000}, async()=>{
  const dir=await mkdtemp(join(tmpdir(),'axiom-delete-'));
  const configPath=join(dir,'config.json');
  await writeFile(configPath,JSON.stringify({workspace:join(dir,'workspace'),sessionDir:join(dir,'sessions'),discoverContext:false}));
  process.env.AXIOM_CONFIG=configPath;
  process.env.PI_CODING_AGENT_DIR=join(dir,'pi-agent');
  const {config}=await import('../src/config.mjs');
  const {Agent}=await import('../src/agent.mjs');
  const fixture=(title)=>{
    const m=SessionManager.create(config.workspace,config.sessionDir);
    m.appendMessage({role:'user',content:title,timestamp:Date.now()});
    m.appendSessionInfo(title);
    return {id:m.getSessionId(),path:m.getSessionFile()};
  };
  const a=fixture('Delete test one'), b=fixture('Delete test two');
  const keep=join(config.workspace,'keep.txt');await writeFile(keep,'retain');
  const agent=new Agent();
  const events=[];agent.subscribe(e=>events.push(e.type));
  try {
    await agent.start();
    assert.equal((await agent.sessions()).length,2);
    assert.equal((await agent.change('switch',a.id)).cancelled,false);
    assert.equal((await agent.state()).sessionId,a.id);
    await agent.change('rename','Renamed fixture');
    assert.equal((await agent.sessions()).find(s=>s.id===a.id).name,'Renamed fixture');
    const details=await agent.sessionDetails();
    assert.ok(details.stats);assert.ok(Array.isArray(details.tree.tree));assert.ok(details.forks.length);
    assert.equal((await agent.change('delete',b.id)).deleted,b.id);
    assert.equal((await agent.state()).sessionId,a.id);
    await assert.rejects(access(b.path),{code:'ENOENT'});
    await assert.rejects(agent.change('delete',b.id),/not found/);
    await assert.rejects(agent.change('delete','../keep.txt'),/not found/);
    assert.equal((await agent.change('delete',a.id)).deleted,a.id);
    assert.notEqual((await agent.state()).sessionId,a.id);
    assert.equal((await agent.sessions()).length,0);
    await assert.rejects(access(a.path),{code:'ENOENT'});
    await access(keep);
    assert.ok(events.includes('state_changed'));
  } finally {await agent.close();await rm(dir,{recursive:true,force:true});}
});
