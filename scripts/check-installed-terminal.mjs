import { pathToFileURL } from "node:url";
import { isAbsolute } from "node:path";
const modulePath = process.env.AXIOM_TEST_PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
import assert from 'node:assert/strict';
const port=process.argv[2],base=process.argv[3];
assert.match(port || "", /^\d+$/);
assert.match(base || "", /^http:\/\/127\.0\.0\.1:\d+$/);
const browser=await chromium.connectOverCDP("http://127.0.0.1:"+port,{timeout:20000});
try{
 const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith(base));
 assert.ok(page,'WebView2 page missing');
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const openWorkbench=async()=>{if(!(await page.locator(".inspector").isVisible()))await page.locator("#show-workbench").click();};
 await openWorkbench();
 await page.locator('.inspector').getByTitle('\u7ec8\u7aef',{exact:true}).click({timeout:20000});
 const panel=page.locator('.wb-panel').filter({has:page.locator('.wb-terminal')});
 await panel.getByRole('button',{name:'\u65b0\u5efa',exact:true}).click();
 await page.locator('.xterm-helper-textarea').waitFor({state:'attached'});
 const waitText=async(needle,timeout=20000)=>{
  try {
   await page.waitForFunction(s=>document.querySelector('.xterm-rows')?.textContent.includes(s),needle,{timeout});
  } catch(error) {
   const output=await page.locator('.xterm-rows').textContent().catch(()=>null);
   const notice=await page.locator('.wb-terminal').textContent().catch(()=>null);
   const terminals=await page.request.get(base+'/api/terminals').then(r=>r.text()).catch(()=>null);
   console.error('PTY_READY_DIAGNOSTIC',JSON.stringify({needle,output:output?.slice(-2000),notice:notice?.slice(-1000),terminals:terminals?.slice(-2000)}));
   throw error;
  }
 };
 // First PowerShell startup on a cold Windows runner may take longer than reconnect.
 await waitText('PS ',60000);
 await page.locator('.xterm-helper-textarea').focus();
 await page.keyboard.type("Write-Output ('AXIOM_'+'RUST_WEBVIEW_OK')");await page.keyboard.press('Enter');await waitText('AXIOM_RUST_WEBVIEW_OK');
 await page.keyboard.type("Write-Output ([string][char]0x4E2D + [string][char]0x6587)");await page.keyboard.press('Enter');await waitText('\u4e2d\u6587');
 console.log('WEBVIEW_INPUT_UTF8_OK');
 const records=await (await page.request.get(base+'/api/terminals')).json();assert.equal(records.length,1);
 await page.reload();
 await openWorkbench();
 const restore=page.getByRole('button',{name:new RegExp(records[0].id.slice(0,8))});
 try{await restore.waitFor({timeout:3000});}catch{await page.locator('.inspector').getByTitle('\u7ec8\u7aef',{exact:true}).click({timeout:20000});}
 await restore.click({timeout:20000});
 await waitText('AXIOM_RUST_WEBVIEW_OK');
 await page.locator('.xterm-helper-textarea').focus();
 await page.keyboard.type("Write-Output ('AXIOM_'+'RECONNECTED_OK')");await page.keyboard.press('Enter');await waitText('AXIOM_RECONNECTED_OK');
 await panel.getByRole('button',{name:'\u7ed3\u675f',exact:true}).click();
 assert.deepEqual(errors,[]);
 console.log('WEBVIEW2_PTY_PARITY_OK');
} finally {await browser.close();}
