import test from "node:test";
import assert from "node:assert/strict";
import {validateRequest,validateAnswer,INTERACTION_TITLE,decodeRequest} from "../src/interaction-protocol.mjs";
import registerInteractions from "../src/interactions.ts";
import registerGoal from "../src/goal.ts";
import {projectHarness} from "../src/harness-state.mjs";
const questions={kind:"questions",questions:[{id:"one",question:"Choose",options:[{label:"A"},{label:"B"}]},{id:"two",question:"More",multiSelect:true,options:[{label:"C"},{label:"D"}]}]};
function harness(register){
 const entries=[],commands=new Map(),tools=new Map(),handlers=new Map();
 let reply;
 const pi={appendEntry:(customType,data)=>entries.push({type:"custom",customType,data}),registerCommand:(name,value)=>commands.set(name,value),registerTool:tool=>tools.set(tool.name,tool),on:(name,fn)=>handlers.set(name,fn)};
 const ctx={sessionManager:{getBranch:()=>entries},ui:{notify(){},async editor(title,prefill){assert.equal(title,INTERACTION_TITLE);decodeRequest({method:"editor",title,prefill});return reply;}}};
 register(pi);
 return{entries,commands,tools,handlers,ctx,setReply:value=>reply=value};
}
test("structured batches validate IDs, selections, and explicit skip",()=>{
 const request=validateRequest(questions);
 assert.throws(()=>validateRequest({...questions,questions:[questions.questions[0],questions.questions[0]]}),/duplicate/);
 const answer={answers:[{id:"two",selected:["C","D"],custom:" notes "},{id:"one",selected:[],skipped:true}]};
 assert.deepEqual(validateAnswer(request,JSON.stringify(answer)),{answers:[{id:"one",selected:[],skipped:true},{id:"two",selected:["C","D"],custom:"notes"}]});
 for(const a of [{id:"one",selected:["A","B"]},{id:"one",selected:["invalid"]},{id:"one",selected:[]}]) assert.throws(()=>validateAnswer(request,JSON.stringify({answers:[a,answer.answers[0]]})));
});
test("plan mode refuses mutations until explicit review approval",async()=>{
 const h=harness(registerInteractions);
 await h.commands.get("axiom-plan").handler("on",h.ctx);
 const gate=h.handlers.get("tool_call");
 assert.equal(gate({toolName:"write"},h.ctx).block,true);
 assert.equal(gate({toolName:"read"},h.ctx),undefined);
 const review=h.tools.get("review_plan"),args={title:"Plan",markdown:"Change fixture"};
 for(const decision of ["reject","revise","approve"]){
   h.setReply(JSON.stringify({decision,feedback:"explicit feedback"}));
   const result=await review.execute("id",args,undefined,undefined,h.ctx);
   assert.equal(result.details.decision,decision);
   assert.equal(gate({toolName:"write"},h.ctx)?.block,decision==="approve"?undefined:true);
 }
});
test("goal continuation consumes bounded budget and pauses for interaction or restore",async()=>{
 const h=harness(registerGoal),cmd=h.commands.get("axiom-goal"),boundary=h.handlers.get("agent_before_settle");
 const event={outcome:"completed",context:{canContinue:true,pendingMessages:[]},continue:false};
 const start=()=>h.handlers.get("before_agent_start")({messageType:"user",systemPrompt:"base"},h.ctx);
 await cmd.handler("1 verify result",h.ctx);start();
 const first=boundary(event,h.ctx);
 assert.equal(first.continue,true);assert.equal(first.entries[0].data.remaining,0);
 h.entries.push(first.entries[0]);
 assert.equal(boundary(event,h.ctx).entries[0].data.phase,"exhausted");
 await cmd.handler("2 verify result",h.ctx);start();h.handlers.get("ui_prompt_start")({},h.ctx);
 assert.equal(boundary(event,h.ctx).entries[0].data.phase,"paused");
 await cmd.handler("2 verify result",h.ctx);h.handlers.get("session_start")({},h.ctx);start();
 assert.equal(boundary(event,h.ctx),undefined);
 assert.equal(h.entries.at(-1).data.phase,"paused");
});
test("projection follows active Pi branch only",()=>{
 const tree=[{entry:{id:"a",type:"custom",customType:"axiom-plan-mode-v1",data:true,parentId:null},children:[{entry:{id:"b",parentId:"a",type:"custom",customType:"axiom-plan-mode-v1",data:false},children:[]},{entry:{id:"c",parentId:"a",type:"custom",customType:"axiom-goal-v1",data:{objective:"fixture"}},children:[]}]}];
 assert.deepEqual(projectHarness({tree,leafId:"c"}),{planMode:true,goal:{objective:"fixture"}});
 assert.deepEqual(projectHarness({tree,leafId:"b"}),{planMode:false,goal:null});
});

