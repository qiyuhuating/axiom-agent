import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileFingerprint } from "../src/file-fingerprint.mjs";
import register from "../src/file-observation.ts";

test("direct file observations record changed successful calls only", async () => {
  const dir=await mkdtemp(join(tmpdir(),"axiom-file-observation-"));
  const cwd=join(dir,"workspace");
  await mkdir(cwd);
  try {
    const handlers=new Map();
    register({on:(name,fn)=>handlers.set(name,fn)});
    const event={toolName:"write",toolCallId:"one",input:{path:"a.txt"}};
    const call=handlers.get("tool_call"),result=handlers.get("tool_result");
    assert.equal(await fileFingerprint(cwd,"../outside.txt"),null);
    await call(event,{cwd});
    await writeFile(join(cwd,"a.txt"),"first");
    const first=await result(event,{cwd});
    assert.equal(first.details.axiomFileChange.kind,"created");
    assert.equal(first.details.axiomFileChange.before,null);
    assert.match(first.details.axiomFileChange.patch,/^\+first$/m);
    assert.equal(first.details.axiomFileChange.after,(await fileFingerprint(cwd,"a.txt")).sha256);
    await call(event,{cwd});
    assert.equal(await result(event,{cwd}),undefined);
    await call(event,{cwd});
    await call({...event,toolCallId:"two"},{cwd});
    await writeFile(join(cwd,"a.txt"),"second");
    assert.equal(await result(event,{cwd}),undefined);
    assert.equal(await result({...event,toolCallId:"two"},{cwd}),undefined);
    await call(event,{cwd});
    await writeFile(join(cwd,"a.txt"),"third");
    assert.equal(await result({...event,isError:true},{cwd}),undefined);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
