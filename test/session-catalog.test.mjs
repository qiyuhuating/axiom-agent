import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { SessionCatalog } from "../src/session-catalog.mjs";

test("disk catalog matches native metadata and invalidates only changed files", async () => {
  const dir=await mkdtemp(join(tmpdir(),"axiom-catalog-"));
  const sessionDir=join(dir,"sessions");
  try{
    const a=SessionManager.create(dir,sessionDir);
    a.appendMessage({role:"user",content:[{type:"text",text:"alpha"},{type:"text",text:"beta"}],timestamp:1000});
    a.appendSessionInfo(" A ");
    const b=SessionManager.create(dir,sessionDir);
    b.appendMessage({role:"user",content:"second",timestamp:2000});
    b.appendSessionInfo("B");
    const catalog=new SessionCatalog(sessionDir);
    const native=async()=> (await SessionManager.list(dir,sessionDir)).map(({id,name,firstMessage,modified})=>({id,name,firstMessage,modified}));
    const first=await catalog.list();
    assert.deepEqual(first,await native());
    const next=await catalog.list();
    assert.equal(first[0],next[0]);
    assert.equal(first[1],next[1]);
    await appendFile(a.getSessionFile(),JSON.stringify({type:"session_info",id:"new-info",parentId:a.getLeafId(),timestamp:new Date().toISOString(),name:"Renamed"})+"\n");
    const renamed=await catalog.list();
    assert.deepEqual(renamed,await native());
    assert.equal(renamed.find(row=>row.id===b.getSessionId()),first.find(row=>row.id===b.getSessionId()));
    await unlink(b.getSessionFile());
    assert.deepEqual(await catalog.list(),await native());
  }finally{await rm(dir,{recursive:true,force:true});}
});
