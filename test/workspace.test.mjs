import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('workspace editing, revision checks and attachment isolation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'axiom-workspace-'));
 try{
  const config=join(dir,'config.json'),workspace=join(dir,'workspace');
  await writeFile(config,JSON.stringify({workspace,sessionDir:join(dir,'sessions')}));
  process.env.AXIOM_CONFIG=config;
  const {openFile,saveFile,listFiles,upload}=await import('../src/workspace.mjs');
  await writeFile(join(workspace,'hello.txt'),'first');
  assert.ok((await listFiles('')).some(f=>f.name==='hello.txt'));
  const initial=await openFile('hello.txt');
  const saved=await saveFile({path:'hello.txt',text:'second',revision:initial.revision});
  assert.equal((await openFile('hello.txt')).revision,saved.revision);
  await assert.rejects(saveFile({path:'hello.txt',text:'lost',revision:initial.revision}),/changed on disk/);
  assert.equal(await readFile(join(workspace,'hello.txt'),'utf8'),'second');
  const writes=await Promise.allSettled(["alpha","bravo"].map(text=>saveFile({path:"hello.txt",text,revision:saved.revision})));
  assert.equal(writes.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(writes.find(x=>x.status==="rejected").reason.status,409);
  await writeFile(join(workspace,"large.txt"),Buffer.alloc(2*1024*1024));
  assert.deepEqual(await openFile("large.txt"),{kind:"binary",size:2*1024*1024});
  await assert.rejects(openFile('../config.json'),/Outside workspace/);
  await assert.rejects(upload({name:'../bad.txt',data:'YQ=='}),/Invalid attachment/);
  const attached=await upload({name:'test.txt',data:'YQ=='});
  assert.equal((await openFile(attached.path)).text,'a');
 }finally{await rm(dir,{recursive:true,force:true});}
});
