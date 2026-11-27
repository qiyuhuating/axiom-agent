import assert from "node:assert/strict";
import test from "node:test";
import { toolText, toolTextPage, TOOL_PAGE_SIZE } from "../src/tool-history-page.mjs";

test("tool text paging reconstructs masked content without splitting Unicode or accepting stale revisions",()=>{
  const value={text:"x".repeat(TOOL_PAGE_SIZE-25)+"😃".repeat(25000)+" sk-123456789012345678901234567890123456789012345678"};
  const expected=toolText(value);
  assert.ok(!expected.includes("sk-123456789012345678901234567890123456789012345678"));
  let page=toolTextPage(value), joined="";
  const revision=page.revision;
  let pages=0;
  for(;;){
    assert.ok(page.text.length<=TOOL_PAGE_SIZE);
    assert.ok(!/[\ud800-\udbff]$/.test(page.text));
    assert.ok(!/^[\udc00-\udfff]/.test(page.text));
    joined+=page.text;pages++;
    if(page.next===null)break;
    page=toolTextPage(value,page.next,revision);
  }
  assert.equal(joined,expected);
  assert.ok(pages>2);
  assert.throws(()=>toolTextPage({text:"changed"},0,revision),{status:409});
  assert.throws(()=>toolTextPage(value,-1),{status:400});
});
