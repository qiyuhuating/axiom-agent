import assert from "node:assert/strict";
import test from "node:test";
import { historyPage, historyTools } from "../src/history-page.mjs";
const messages = Array.from({length: 2000}, (_, i) => ({ role: "user", content: "history " + i }));
test("history cursors page backwards, preserve appended messages and reject replaced prefixes", () => {
  const recent = historyPage(messages, "a");
  assert.equal(recent.messages.length, 80);
  assert.equal(recent.history.start, 1920);
  const older = historyPage([...messages, {role:"assistant", content:"new"}], "a", {before: recent.history.before});
  assert.equal(older.history.start, 1840);
  assert.equal(older.messages.length, 80);
  assert.equal(older.messages.at(-1).content, "history 1919");
  assert.equal(historyPage(messages, "a", {from:older.history.from}).messages.length, 160);
  assert.throws(() => historyPage(messages, "b", {before: recent.history.before}), {status:409});
  assert.throws(() => historyPage(messages.slice(1), "a", {before: recent.history.before}), {status:409});
  assert.equal(historyPage(messages.slice(1), "a", {from:older.history.from}).messages.length, 80);
  assert.throws(() => historyPage(messages, "a", {before:"invalid"}), {status:400});
});
test("tool projection preserves old call arguments, completion and original turn", () => {
  const raw = [{role:"user",content:"one"},{role:"assistant",content:[{type:"toolCall",id:"t",name:"read",arguments:{path:"a"}}]},
    {role:"toolResult",toolCallId:"t",toolName:"read",content:[{type:"text",text:"ok"}]}, ...messages];
  const {tools,turn}=historyTools(raw);
  assert.equal(turn,2001);
  assert.deepEqual(tools,[{id:"t",name:"read",finished:true,failed:false,args:{path:"a"},turn:1,result:[{type:"text",text:"ok"}]}]);
});

test("initial history summaries omit large tool payloads without losing deliverables", () => {
  const raw = [{role:"user",content:"read"},{role:"assistant",content:[{type:"toolCall",id:"large",name:"read",arguments:{path:"a"}}]},
    {role:"toolResult",toolCallId:"large",toolName:"read",content:[{type:"text",text:"x".repeat(250000)}]},
    {role:"toolResult",toolCallId:"deliver",toolName:"present_files",content:[],details:{kind:"axiom-deliverables-v1",files:[{path:"a",size:1}]} }];
  const projected=historyTools(raw,{summaries:true});
  assert.equal(projected.tools[0].detailDeferred,true);
  assert.equal(projected.tools[0].args,undefined);
  assert.equal(projected.tools[0].result,undefined);
  assert.deepEqual(projected.tools[1].details,raw[3].details);
  assert.ok(JSON.stringify(projected).length < 1000);
  const detail=historyTools(raw,{only:"large"}).tools[0];
  assert.equal(detail.result[0].text.length,250000);
  assert.deepEqual(detail.args,{path:"a"});
});
