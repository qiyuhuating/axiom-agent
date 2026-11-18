import assert from 'node:assert/strict';
const base = process.env.AXIOM_URL || 'http://127.0.0.1:4789';
const get = async path => {
  const r = await fetch(base+path); assert.ok(r.ok, path+' '+r.status);
  return r.json();
};
const post = async (action,value) => {
  const r = await fetch(base+'/api/action', {method:'POST',headers:{Origin:base,'X-Axiom-Client':'1','Content-Type':'application/json'},body:JSON.stringify({action,value})});
  const data=await r.json(); assert.ok(r.ok, JSON.stringify(data)); return data;
};
assert.equal((await get('/api/health')).ok,true);
assert.equal((await get('/api/state')).busy,false);
const response=await fetch(base+'/api/events',{signal:AbortSignal.timeout(90000)});
assert.equal(response.status,200);
const stream=response.body.getReader();
const decoder=new TextDecoder();
let pending='', types=new Set(), text='', read=false, settled=false;
const collect=(async()=>{
  while(!settled){
    const {done,value}=await stream.read(); if(done)break;
    pending+=decoder.decode(value,{stream:true});
    let at;
    while((at=pending.indexOf('\n\n'))>=0){
      const frame=pending.slice(0,at); pending=pending.slice(at+2);
      if(!frame.startsWith('data: '))continue;
      const e=JSON.parse(frame.slice(6)); types.add(e.type);
      if(e.type==='message_update'&&e.assistantMessageEvent.type==='text_delta')text+=e.assistantMessageEvent.delta;
      if(e.type==='tool_execution_end'&&e.toolName==='read'&&!e.isError)read=true;
      if(e.type==='agent_settled')settled=true;
    }
  }
})();
try{
  await post('prompt','Use the read tool on axiom-smoke.txt in this workspace and reply with the exact contents.');
  await collect;
  assert.ok(settled,'agent did not settle');
  assert.ok(read,'read tool did not complete');
  assert.ok(text.includes('AXIOM_OK'),'missing streamed model result');
  console.log('Live SSE verified:', [...types].join(', '));
  console.log('Result:',text);
  const state=await get('/api/state'); assert.equal(state.busy,false);
  const sessions=await get('/api/sessions'); const session=sessions.find(x=>x.id===state.sessionId); assert.ok(session,'session persisted');
  assert.equal((await post('new')).cancelled,false);
  assert.equal((await post('switch',session.id)).cancelled,false);
  assert.ok((await get('/api/messages')).some(x=>x.role==='toolResult'&&x.toolName==='read'));
  console.log('Native session switch and restore verified');
} finally { await stream.cancel(); }
