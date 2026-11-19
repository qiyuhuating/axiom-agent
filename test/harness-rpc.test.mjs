import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {PiClient} from "../src/pi-client.mjs";
import {decodeRequest,validateAnswer} from "../src/interaction-protocol.mjs";
test("native Pi RPC hosts structured question extension and validates returned batch",{timeout:30000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"axiom-structured-")),fixture=join(dir,"fixture.ts");
 const interactions=resolve("src/interactions.ts").replaceAll("\\","/");
 await mkdir(join(dir,"workspace"));
 await writeFile(fixture,'import register from '+JSON.stringify(interactions)+'; export default function(pi){let question; register({registerCommand(){},on(){},registerTool(t){if(t.name==="ask_user_question")question=t;}});pi.registerCommand("fixture-questions",{description:"fixture",handler:async(_args,ctx)=>{const result=await question.execute("fixture",{questions:[{id:"a",question:"Choose",options:[{label:"A"}]},{id:"b",question:"Explain"}]},undefined,undefined,ctx);ctx.ui.notify(result.content[0].text,"info");}}); }');
 const client=new PiClient({cliPath:resolve("node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"),cwd:join(dir,"workspace"),args:["--no-extensions","--no-mcp","--no-skills","--no-context-files","--session-dir",join(dir,"sessions"),"--extension",fixture,"--extension",resolve("src/interactions.ts"),"--extension",resolve("src/goal.ts")],env:{PI_CODING_AGENT_DIR:join(dir,"agent"),PI_OFFLINE:"1"}});
 const events=[];client.onEvent(e=>events.push(e));
 try{
  await client.start();
  assert.ok((await client.getCommands()).some(c=>c.name==="axiom-goal"));
  assert.equal(await client.prompt("/axiom-plan on"),"handled");
  assert.ok((await client.getTree()).leafId);
  const pending=client.prompt("/fixture-questions");pending.catch(()=>{});
  let dialog;for(let i=0;i<100&&!dialog;i++){dialog=events.find(e=>e.type==="extension_ui_request"&&e.method==="editor");if(!dialog)await delay(30);}
  assert.ok(dialog,"native editor request");
  const request=decodeRequest(dialog);
  const payload=JSON.stringify({answers:[{id:"a",selected:["A"]},{id:"b",selected:[],custom:"verified"}]});
  assert.equal(request.questions.length,2);
  await client.respond({type:"extension_ui_response",id:dialog.id,value:payload});
  assert.equal(await pending,"handled");
  const notification=events.find(e=>e.type==="extension_ui_request"&&e.method==="notify"&&e.message.includes("verified"));
  assert.ok(notification,"tool result traversed real RPC");
  assert.deepEqual(JSON.parse(notification.message),validateAnswer(request,payload));
 }finally{await client.stop();await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
});

