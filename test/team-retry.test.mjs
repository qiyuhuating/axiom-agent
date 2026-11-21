import test from "node:test";
import assert from "node:assert/strict";
import {retryTeam} from "../src/team-retry.mjs";
test("retry retains completed dependencies and revokes abandoned attempt mail",()=>{
 const root={id:"a",node:"a",team:"t",status:"completed",results:[{text:"done"}]};
 const failed={id:"b",node:"b",team:"t",status:"failed",results:[{text:"partial"}],blockedBy:["a"]};
 const child={id:"c",node:"c",team:"t",status:"blocked",results:[],blockedBy:["b"]};
 const state={jobs:[root,failed,child],mail:[{team:"t",from:"b",to:"a"},{team:"other",from:"b",to:"a"}]};
 assert.throws(()=>retryTeam(state,"t",new Set(["b"])),/inactive/);
 failed.cleanupError="worker stop failed";
 assert.throws(()=>retryTeam(state,"t",new Set()),/incompletely stopped/);
 delete failed.cleanupError;
 assert.equal(retryTeam(state,"t",new Set()),2);
 assert.equal(root.status,"completed");assert.deepEqual(root.results,[{text:"done"}]);
 assert.equal(failed.status,"queued");assert.deepEqual(failed.results,[]);assert.equal(failed.attempt,2);
 assert.deepEqual(child.blockedBy,["b"]);assert.equal(child.status,"queued");
 assert.deepEqual(state.mail,[{team:"other",from:"b",to:"a"}]);
});
