import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openJobStore } from "../src/job-store.mjs";

test("legacy history retains order and unchanged rows survive incremental commits", () => {
  const dir=mkdtempSync(join(tmpdir(),"axiom-migrate-"));
  let store;
  try {
    const state={jobs:[{id:"B",status:"running"},{id:"A",status:"completed"}],plans:{},schedules:[],mail:[]};
    const legacy=join(dir,"state.json");
    const original=JSON.stringify(state);
    writeFileSync(legacy,original);
    store=openJobStore(dir);
    const db=new DatabaseSync(join(dir,"jobs.sqlite"));
    try {
      db.exec("CREATE TRIGGER retain_history BEFORE UPDATE ON jobs WHEN OLD.id='A' BEGIN SELECT RAISE(ABORT,'cold history rewritten'); END");
      store.save([{id:"B",status:"completed"}],false);
      store.state.plans.sample={goal:"done"};
      store.save([],true);
    } finally {db.close();}
    store.close();store=openJobStore(dir);
    assert.deepEqual(store.state.jobs,[{id:"B",status:"completed"},state.jobs[1]]);
    assert.equal(store.state.plans.sample.goal,"done");
    assert.equal(readFileSync(legacy,"utf8"),original);
  }finally{store?.close();rmSync(dir,{force:true,recursive:true});}
});
