import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { SessionEntryIndex } from "../src/session-entry-index.mjs";
import { projectSessionHistory, projectSessionHistoryEntries } from "../src/harness-state.mjs";

test("Pi entry index sends only append deltas, resolves branch, compaction, edit and resets on removed cursor", async () => {
  let manager=SessionManager.inMemory();
  const message=text=>manager.appendMessage({role:"user",content:text,timestamp:Date.now()});
  const first=message("first");
  const second=message("second");
  manager.appendCustomEntry("axiom-plan-mode-v1",true);
  const requests=[];
  const counts=[];
  const client={async getEntries(since){
    requests.push(since);
    const entries=manager.getEntries();
    let start=0;
    if(since){const i=entries.findIndex(e=>e.id===since);if(i<0)throw Error("Entry not found: "+since);start=i+1;}
    counts.push(entries.length-start);
    return {entries:entries.slice(start),leafId:manager.getLeafId()};
  }};
  const index=new SessionEntryIndex();
  async function read(){
    const projection=await index.read(client,"session");
    assert.deepEqual(projection.messages,manager.buildSessionContext().messages);
    assert.deepEqual(projectSessionHistoryEntries(projection.entries,projection.leafId),projectSessionHistory({tree:manager.getTree(),leafId:manager.getLeafId()}));
    return projection;
  }
  assert.equal((await read()).harness.planMode,true);
  await read();
  const tail=manager.getLeafId();
  assert.equal(requests.at(-1),tail);
  assert.equal(counts.at(-1),0);
  message("third");
  await read();
  assert.equal(counts.at(-1),1);
  manager.branch(first);
  message("alternate");
  assert.equal((await read()).harness.planMode,false);
  assert.equal(counts.at(-1),1);
  manager.branch(second);
  manager.appendContextEdit(second,{content:"edited"});
  await read();
  manager.appendCompaction("compact",second,1000);
  message("after compaction");
  await read();
  assert.equal(counts.at(-1),2);
  manager=SessionManager.inMemory();
  message("replacement");
  await read();
  assert.equal(counts.at(-1),1);
  assert.equal(requests.at(-1),undefined);
  console.log("PI_ENTRY_DELTA_PASS",JSON.stringify({counts}));
});
