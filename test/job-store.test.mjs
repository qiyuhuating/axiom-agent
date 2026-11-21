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
      store.save([],{table:"plans",id:"sample",value:{goal:"done"}});
    } finally {db.close();}
    store.close();store=openJobStore(dir);
    assert.deepEqual(store.state.jobs,[{id:"B",status:"completed"},state.jobs[1]]);
    assert.equal(store.state.plans.sample.goal,"done");
    assert.equal(readFileSync(legacy,"utf8"),original);
  }finally{store?.close();rmSync(dir,{force:true,recursive:true});}
});

test("0.5.1 metadata migrates once and retry writes roll back together", () => {
  const dir = mkdtempSync(join(tmpdir(),"axiom-meta-"));
  let store;
  try {
    const db = new DatabaseSync(join(dir,"jobs.sqlite"));
    const msg = {id:"m1", team:"red", to:"a"};
    const schedule = {id:"s1",enabled:true};
    const plan = {goal:"original"};
    try {
      db.exec("CREATE TABLE jobs(id TEXT UNIQUE NOT NULL,value TEXT NOT NULL); CREATE TABLE metadata(id INTEGER PRIMARY KEY,value TEXT NOT NULL)");
      db.prepare("INSERT INTO metadata VALUES(1,?)").run(JSON.stringify({plans:{p1:plan},schedules:[schedule],mail:[msg]}));
      db.prepare("INSERT INTO jobs VALUES(?,?)").run("j",JSON.stringify({id:"j",status:"failed",team:"red"}));
    } finally { db.close(); }
    store=openJobStore(dir);
    assert.deepEqual(store.enabledSchedules(),[schedule]);
    assert.deepEqual(store.inbox("red","a"),[msg]);
    assert.deepEqual(store.active(),[]);
    const j={...store.job("j"),status:"queued"};
    const guard=new DatabaseSync(join(dir,"jobs.sqlite"));
    try {
      guard.exec("CREATE TRIGGER stop_delete BEFORE DELETE ON mail BEGIN SELECT RAISE(ABORT,'fixture'); END");
      assert.throws(()=>store.save([j],{removeMail:["m1"]}),/fixture/);
      assert.deepEqual(store.active(),[]);
      assert.equal(store.mailCount("red"),1);
      guard.exec("DROP TRIGGER stop_delete");
      store.save([j],{removeMail:["m1"]});
      store.save([],{table:"schedules",id:"s1"});
    } finally { guard.close(); }
    store.close();store=openJobStore(dir);
    assert.deepEqual(store.active(),[j]);
    assert.deepEqual(store.team("red"),[j]);
    assert.deepEqual(store.state,{jobs:[j],plans:{p1:plan},schedules:[],mail:[]});
  } finally {store?.close();rmSync(dir,{recursive:true,force:true});}
});

test("history pages retain their insertion boundary and omit task payloads", () => {
  const dir = mkdtempSync(join(tmpdir(), "axiom-cursor-"));
  const store = openJobStore(dir);
  try {
    const jobs = ["a", "b", "c"].map(id => ({id, label:id, status:"completed", team:"t", results:[{text:id}]}));
    store.save(jobs);
    const first = store.page(null, 2);
    assert.deepEqual(first.jobs.map(j=>j.id), ["c", "b"]);
    assert.deepEqual(first.teamJobs.map(j=>j.id), ["c", "b", "a"]);
    assert.ok(first.jobs.every(j=>!("results" in j)));
    store.save([{...jobs[1],status:"failed"}, {...jobs[0],id:"d"}]);
    assert.deepEqual(store.page(first.cursor, 2).jobs.map(j=>j.id), ["c", "b"]);
    const last = store.page(first.nextCursor, 2);
    assert.deepEqual(last.jobs.map(j=>j.id), ["a"]);
    assert.equal(last.nextCursor, null);
    assert.deepEqual(store.job("b").results,[{text:"b"}]);
    assert.equal(store.page(null, 2).jobs[0].id,"d");
  } finally {
    store.close();
    rmSync(dir, {recursive:true,force:true});
  }
});
