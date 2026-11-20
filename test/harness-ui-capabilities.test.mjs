import {test} from "node:test";
import assert from "node:assert/strict";
import {maskCredentials} from "../ui/credential-mask.ts";
import {detectTrigger} from "../vendor/dsh/input/detect.ts";
import {formatFileMention} from "../vendor/dsh/input/grammar.ts";
test("upstream mask preserves noncredentials and masks known formats",()=>{
 const key="ghp_"+"A".repeat(36);
 assert.equal(maskCredentials("ordinary text"),"ordinary text");
 assert.equal(maskCredentials("prefix "+key+" end"),"prefix "+key.slice(0,8)+"*".repeat(32)+" end");
 assert.equal(maskCredentials("https://user:password@example.com"),"https://user:********@example.com");
 const block="-----BEGIN PRIVATE KEY-----\n"+"synthetic-test-content\n"+"-----END PRIVATE KEY-----";
 assert.ok(!maskCredentials(block).includes("synthetic-test-content"));
});
test("upstream composer trigger boundary and quoting",()=>{
 assert.equal(detectTrigger("https://example.com",19,{tier:"plain"}),null);
 assert.equal(detectTrigger("user@example.com",16,{tier:"plain"}),null);
 assert.equal(detectTrigger("/re",3,{tier:"plain"}).query,"re");
 assert.equal(detectTrigger('@"some dir',10,{tier:"plain"}).quoted,true);
 assert.equal(formatFileMention({path:"some dir/a.txt",kind:"file"},false),'@"some dir/a.txt"');
});
