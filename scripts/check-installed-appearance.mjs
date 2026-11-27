import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { isAbsolute,join } from "node:path";
const modulePath = process.env.AXIOM_TEST_PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(isAbsolute(modulePath) ? pathToFileURL(modulePath).href : modulePath);
import { mkdir } from "node:fs/promises";
const [port,base]=process.argv.slice(2);
assert.match(port || "", /^\d+$/);
assert.match(base || "", /^http:\/\/127\.0\.0\.1:\d+$/);
const directory=process.env.AXIOM_UI_SCREENSHOT_DIR;
const capture=async(page,name)=>{if(directory){await mkdir(directory,{recursive:true});await page.screenshot({path:join(directory,name)});}};
const browser=await chromium.connectOverCDP("http://127.0.0.1:"+port);
try{
 const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith(base));assert.ok(page);
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.waitForFunction(()=>document.querySelector("#status")?.textContent==="就绪",null,{timeout:30000});
 // Harness two-level ModelSelect, tested without changing real Pi settings.
 const fakeModels=[
  {provider:"fixture-A",id:"alpha-1"},{provider:"fixture-A",id:"beta-2"},
  {provider:"fixture-B",id:"gamma-3"},{provider:"fixture-B",id:"delta-4"},
  {provider:"fixture-B",id:"epsilon-5"}
 ];
 const calls=[];
 await page.route("**/api/models",route=>route.fulfill({json:fakeModels}));
 await page.route("**/api/levels",route=>route.fulfill({json:["low","medium","high"]}));
 await page.route("**/api/action",route=>{
  const request=route.request().postDataJSON();
  if(request.action==="model"||request.action==="thinking"){
   calls.push(request);return route.fulfill({json:{ok:true}});
  }
  return route.continue();
 });
 await page.reload();
 await page.locator("#models").click();
 const menu=page.getByRole("menu",{name:"模型和思考强度"});
 await menu.getByRole("menuitem").first().click();
 const modelMenuBackground=await menu.evaluate(element=>getComputedStyle(element).backgroundColor);
 assert.match(modelMenuBackground,/^rgb\(/,"Model menu must have an opaque surface over the conversation");
 const menuRect=await menu.boundingBox();
 assert.ok(menuRect&&menuRect.x>=0&&menuRect.y>=0&&menuRect.x+menuRect.width<=await page.evaluate(()=>innerWidth),"Model menu must fit viewport"); await capture(page,"model-select.png");
 await page.getByRole("textbox",{name:"搜索模型"}).fill("beta");
 await menu.getByRole("menuitemradio",{name:"beta-2"}).click();
 assert.deepEqual(calls.at(-1),{action:"model",value:{provider:"fixture-A",id:"beta-2"}});
 await page.locator("#models").click();
 await menu.getByRole("menuitem").last().click();
 await menu.getByRole("menuitemradio",{name:"high"}).click();
 assert.deepEqual(calls.at(-1),{action:"thinking",value:"high"});
 await page.locator("#models").click();
 await menu.getByRole("menuitem").first().click();
 await page.keyboard.press("Escape");
 await menu.getByRole("menuitem").first().waitFor();
 await page.keyboard.press("Tab");
 await menu.waitFor({state:"detached"});
 await page.unroute("**/api/action");
 await page.unroute("**/api/models");
 await page.unroute("**/api/levels");
 await page.reload();
 await page.waitForFunction(()=>document.querySelector("#status")?.textContent==="就绪"); await page.getByRole('button',{name:'会话管理'}).click();
 const sessionControls=page.getByRole('dialog',{name:'会话管理'});
 await sessionControls.locator('pre').waitFor();
 await sessionControls.getByLabel('操作').selectOption('history');
 await sessionControls.getByRole('list',{name:'会话历史'}).or(sessionControls.getByText('暂无会话记录。',{exact:true})).waitFor();
 await sessionControls.getByLabel('操作').selectOption('abort-retry');
 assert.ok(await sessionControls.getByRole('button',{name:'应用'}).isDisabled());
 await sessionControls.getByLabel('操作').selectOption('rename');
 await sessionControls.getByLabel('会话名称').waitFor();
 await sessionControls.getByRole('button',{name:'关闭'}).click();
 await page.evaluate(()=>localStorage.setItem("axiom.appearance","light"));await page.reload();
 await page.locator("#theme-toggle svg").waitFor();
 assert.equal(await page.locator("body").getAttribute("data-ds-dark-theme"),null);
 assert.equal(await page.locator(".inspector").isVisible(),false);
 const theme=()=>page.evaluate(()=>({bg:getComputedStyle(document.body).backgroundColor,sidebar:getComputedStyle(document.querySelector(".sidebar")).backgroundColor,radius:getComputedStyle(document.querySelector(".composer form")).borderRadius}));
 const a=await theme();assert.equal(a.bg,"rgb(250, 250, 250)");assert.equal(a.radius,"14px");
 await capture(page,"light.png");
 await page.locator("#theme-toggle").click();assert.ok((await theme()).bg==="rgb(16, 16, 16)");await capture(page,"dark.png");
await page.locator("#models").click();
const darkModelMenu=page.getByRole("menu",{name:"模型和思考强度"});
await darkModelMenu.waitFor();
assert.notEqual(await darkModelMenu.evaluate(element=>getComputedStyle(element).backgroundColor),"rgb(255, 255, 255)");
await capture(page,"model-select-dark.png");
await page.keyboard.press("Escape");
await darkModelMenu.waitFor({state:"detached"});
 if(await page.locator("#sidebar-toggle").isVisible()){await page.locator("#sidebar-toggle").click();await page.waitForFunction(()=>document.querySelector('.sidebar')?.offsetWidth===56);await page.locator("#sidebar-open").click();}
 await page.locator("#theme-toggle").click();
 await page.locator("#show-workbench").click();await page.locator(".inspector").getByTitle("终端",{exact:true}).waitFor();
 assert.equal(await page.locator(".wb-launch").count(),0);
 await page.locator("#rightbar-collapse").waitFor();
 const widthBefore=await page.locator(".inspector").evaluate(element=>element.getBoundingClientRect().width);
 const handle=page.getByRole("separator",{name:"调整右侧栏宽度"});
 await handle.focus();await handle.press("ArrowLeft");
 await page.waitForFunction(w=>document.querySelector(".inspector")?.getBoundingClientRect().width>w+8,widthBefore);
 const dragBefore=await page.locator(".inspector").evaluate(e=>e.getBoundingClientRect().width);
 const edge=await handle.boundingBox();assert.ok(edge);
 await page.mouse.move(edge.x+edge.width/2,edge.y+edge.height/2);
 await page.mouse.down();
 await page.mouse.move(edge.x-48,edge.y+edge.height/2,{steps:6});
 await page.mouse.up();
 await page.waitForFunction(w=>document.querySelector(".inspector")?.getBoundingClientRect().width>w+24,dragBefore);
 assert.ok(await page.evaluate(()=>Number(localStorage.getItem("axiom.rightbar.width"))>0));

 await page.getByRole("button",{name:"全屏展开"}).click();
 await page.waitForFunction(()=>{const p=document.querySelector(".inspector")?.getBoundingClientRect();return p&&Math.abs(p.left)<2&&Math.abs(p.width-innerWidth)<2;});
 await page.getByRole("button",{name:"退出全屏"}).click();
 await capture(page,"workbench.png");
 await page.locator(".inspector").getByRole("button",{name:"执行轨迹"}).click();
 await page.locator("#trace").waitFor();
 await capture(page,"trajectory.png");
 await page.locator("#rightbar-collapse").click();
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.inspector [data-dockkit-host="dock"]')).visibility==="hidden",null,{timeout:1500});
 await page.locator('#sidebar-panels').getByRole('button',{name:'文件',exact:true}).click();
 await page.getByTitle('刷新文件',{exact:true}).waitFor();
 await capture(page,'files.png');
 await page.locator('#sidebar-panels').getByRole('button',{name:'浏览器',exact:true}).click();
 await page.getByRole('textbox',{name:'浏览器地址'}).waitFor();
 await capture(page,'browser.png');
 await page.locator('#sidebar-panels').getByRole('button',{name:'Git Diff',exact:true}).click();
 await page.locator('.inspector').locator('.wb-panel strong').filter({hasText:/^Git /}).waitFor();
 await capture(page,'diff.png');
 await page.locator('#sidebar-settings').click();
 await page.getByRole('button',{name:'模型提供商',exact:true}).click();
 await page.getByPlaceholder('https://api.example.com/v1').waitFor();
 await capture(page,'settings.png');
 await page.getByRole('button',{name:'通用与权限',exact:true}).click();
 await page.getByLabel('权限模式').waitFor();
 await page.getByRole('button',{name:'内置提示词',exact:true}).click();
 const builtin = page.getByLabel('内置提示词',{exact:true});
 await builtin.waitFor();
 await page.waitForFunction(()=>document.querySelector('.settings-section textarea')?.disabled===false);
 const defaultPrompt = await builtin.inputValue();
 await builtin.fill('Installer prompt fixture');
 await page.getByRole('button',{name:'保存提示词'}).click();
 await page.getByText('已保存',{exact:true}).waitFor();
 assert.equal((await (await page.request.get(base+'/api/builtin-prompt')).json()).text,'Installer prompt fixture');
 await page.getByRole('button',{name:'恢复默认'}).click();
 await page.getByText('已保存',{exact:true}).waitFor();
 assert.equal(await builtin.inputValue(),defaultPrompt);
 assert.equal((await (await page.request.get(base+'/api/builtin-prompt')).json()).text,defaultPrompt);
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 await page.locator('#sidebar-panels').getByRole('button',{name:'任务与计划',exact:true}).click();
 await page.getByLabel('DAG 节点').waitFor();
 await capture(page,'jobs.png');
 await page.locator('#sidebar-panels').getByRole('button',{name:'Skills / MCP',exact:true}).click();
 await page.getByLabel('MCP URL').waitFor();
 await capture(page,'resources.png');
 await page.getByRole('button',{name:'搜索会话',exact:true}).click();
 await page.getByRole('textbox',{name:'搜索会话'}).fill('no-match-axiom');
 await page.getByRole('textbox',{name:'搜索会话'}).press('Escape');
 await page.locator('#rightbar-collapse').click();
 const prompt=page.locator('#prompt');
 await prompt.fill('/');
 const options=page.locator('#axiom-composer-list [role=option]');
 await options.first().waitFor();
 await capture(page,"slash-menu.png");
 const first=await options.first().innerText();
 await prompt.press('Enter');
 await prompt.locator('[data-composer-command]').waitFor();
 assert.ok((await prompt.textContent()).startsWith('/'));
 assert.ok(first.length>1);
 await prompt.fill('@axiom-fixture');
 await page.getByRole('option').filter({hasText:'axiom-fixture.txt'}).waitFor();
 await capture(page,'file-reference.png');
 await prompt.press('Tab');
 await prompt.locator('[data-composer-chip=workspace-file]').waitFor();
 assert.equal(await prompt.locator('[data-composer-chip=workspace-file]').innerText(),'axiom-fixture.txt');
 await prompt.press('End');
 await prompt.press('Backspace');
 await prompt.press('Backspace');
 await prompt.locator('[data-composer-chip]').waitFor({state:'detached'});
 // Lexical suppresses synthetic insertText immediately after a handled Backspace.
 // Real key presses exercise the composer without that automation-only race.
 await prompt.pressSequentially('Draft retained on reload');
 assert.equal(await prompt.textContent(),'Draft retained on reload');
 await page.reload();
 await page.waitForFunction(()=>document.querySelector('#prompt')?.textContent==='Draft retained on reload');
 await prompt.fill('');
 // Inject a test-only history response, never submit a model prompt or credential.
 const fixtureSnapshot = (patch) => page.route("**/api/snapshot*",async route=>{
  const response=await route.fetch();
  const snapshot=await response.json();
  await route.fulfill({response,json:{...snapshot,history:null,historyTools:null,...patch(snapshot)}});
 });
 let draftSession="fixture-draft-a";
 const draftSessions=[{id:"fixture-draft-a",name:"Draft fixture A"},{id:"fixture-draft-b",name:"Draft fixture B"}];
 await fixtureSnapshot(snapshot=>({state:{...snapshot.state,sessionId:draftSession},sessions:draftSessions}));
 await page.route("**/api/action",route=>{
  const request=route.request().postDataJSON();
  if(request.action!=="switch")return route.continue();
  draftSession=request.value;
  return route.fulfill({json:{cancelled:false}});
 });
 await page.reload();
 await page.locator("#sessions [aria-current=page]").getByText("Draft fixture A").waitFor();
 await prompt.fill("First draft");
 await page.locator("#attach-input").setInputFiles({name:"draft-fixture.png",mimeType:"image/png",buffer:Buffer.from("test")});
 await page.getByRole("button",{name:/draft-fixture.png/}).waitFor();
 await page.getByRole("button",{name:"Draft fixture B",exact:true}).click();
 await page.locator("#sessions [aria-current=page]").getByText("Draft fixture B").waitFor();
 assert.equal(await prompt.textContent(),"");
 assert.equal(await page.locator("#attachment-list").textContent(),"");
 await prompt.fill("Second draft");
 await page.getByRole("button",{name:"Draft fixture A",exact:true}).click();
 await page.locator("#sessions [aria-current=page]").getByText("Draft fixture A").waitFor();
 assert.equal(await prompt.textContent(),"First draft");
 await page.getByRole("button",{name:/draft-fixture.png/}).waitFor();
 await page.unroute("**/api/action");
 await page.unroute("**/api/snapshot*");
 await page.addInitScript(()=>{
  window.EventSource=class extends window.EventSource{
   constructor(url,options){super(url,options);window.axiomTestEvents=this;}
  };
 });
 await fixtureSnapshot(()=>({messages:Array.from({length:30},(_,index)=>({role:"assistant",content:"Fixture history "+index+"\n"+"Line of history\n".repeat(5)}))}));
 await page.reload();
 await page.getByText('Fixture history 29',{exact:false}).waitFor();
 await page.locator('#transcript').evaluate(element=>{element.scrollTop=0;});
 const jump=page.getByRole('button',{name:'回到最新消息'});
 await jump.waitFor();
 await page.evaluate(()=>window.axiomTestEvents.dispatchEvent(new MessageEvent("message",{data:JSON.stringify({
  type:"message_update",assistantMessageEvent:{type:"text_delta",delta:"Streaming while reading"}
 })})));
 await page.getByText("Streaming while reading",{exact:true}).waitFor({state:"attached"});
 assert.equal(await page.locator('#transcript').evaluate(element=>element.scrollTop),0);
 await jump.click();
 await jump.waitFor({state:'detached'});
 assert.ok(await page.locator('#transcript').evaluate(element=>element.scrollHeight-element.scrollTop-element.clientHeight<2));
 await page.unroute("**/api/snapshot*");
 await fixtureSnapshot(()=>({messages:[{role:"assistant",content:[{type:"text",text:"Fixture quote to reference"}]},{role:"user",content:[{type:"text",text:"fixture ghp_"+"A".repeat(36)}]},{role:"toolResult",toolCallId:"delivery-fixture",toolName:"present_files",content:[{type:"text",text:"Presented to user: axiom-fixture.txt"}],details:{kind:"axiom-deliverables-v1",files:[{path:"axiom-fixture.txt",size:20}]}}]}));
 await page.reload();
 await page.locator("#transcript .axiom-message.user").waitFor();
 assert.equal(await page.locator("#transcript .axiom-message.user").evaluate(e=>getComputedStyle(e).backgroundColor),"rgba(0, 0, 0, 0)");
 await page.locator("#transcript .axiom-message.user").getByRole("button",{name:"复制消息"}).waitFor();
 assert.equal(await page.locator('nav[aria-label="会话视图"]').count(),0);
 await capture(page,"conversation.png");
 const reply=page.locator("#transcript article.assistant").first();
 await reply.hover();
 await reply.getByRole("button",{name:"引用",exact:true}).click();
 await prompt.locator("[data-composer-quote]").waitFor();
 assert.match(await prompt.locator("[data-composer-quote]").innerText(),/Fixture quote to reference/);
 await prompt.getByRole("button",{name:"移除引用"}).click();
 await prompt.locator("[data-composer-quote]").waitFor({state:"detached"});
 const fixture=page.locator("#transcript article.user");
 await fixture.getByRole("button",{name:"显示凭据"}).waitFor();
 assert.ok(!(await fixture.innerText()).includes("A".repeat(36)));
 await fixture.getByRole("button",{name:"显示凭据"}).click();
 assert.ok((await fixture.innerText()).includes("A".repeat(36)));
 await fixture.getByRole("button",{name:"隐藏凭据"}).click();
 await page.getByRole("button",{name:"预览 axiom-fixture.txt"}).waitFor();
 await page.getByRole("button",{name:"预览 axiom-fixture.txt"}).click();
 await page.locator(".inspector").waitFor();
 await page.unroute("**/api/snapshot*");await page.reload();
 // Browser-only recovery fixture: no new model run or permission request.
 const request={kind:"questions",questions:[{id:"q1",question:"Fixture choice",options:[{label:"Pick A"}]},{id:"q2",question:"Fixture custom"}]};
 const dialog={id:"fixture-question-draft",method:"editor",title:"Axiom structured interaction v1",prefill:JSON.stringify(request)};
 let live=[dialog], response;
 await fixtureSnapshot(()=>({dialogs:live}));
 await page.route("**/api/ui-response",route=>{response=route.request().postDataJSON();live=[];return route.fulfill({json:{ok:true}});});
 await page.reload();
 await page.getByRole("button",{name:/Pick A/}).click();
 await page.getByRole("button",{name:"下一题"}).click();
 await page.getByLabel("自定义答案").fill("draft survives reload");
 await page.reload();
 await page.getByText("Fixture custom",{exact:true}).waitFor();
 assert.equal(await page.getByLabel("自定义答案").inputValue(),"draft survives reload");
 await page.getByRole("button",{name:"提交答案"}).click();
 await page.getByText("Fixture custom",{exact:true}).waitFor({state:"detached"});
 assert.deepEqual(JSON.parse(response.value).answers.map(a=>({id:a.id,selected:a.selected,custom:a.custom})),[{id:"q1",selected:["Pick A"],custom:""},{id:"q2",selected:[],custom:"draft survives reload"}]);
 assert.equal(await page.evaluate(()=>sessionStorage.getItem("axiom.question-draft.v1:fixture-question-draft")),null);
 await page.unroute("**/api/snapshot*");await page.unroute("**/api/ui-response");
 await page.reload();
 // A failed authoritative snapshot must never expose a false-ready composer.
 await page.route("**/api/snapshot*",route=>route.fulfill({status:503,contentType:"text/plain",body:"Unavailable"}));
 await page.reload();
 await page.getByText("同步失败",{exact:true}).waitFor();
 assert.equal(await page.locator("#send").isDisabled(),true);
 await page.unroute("**/api/snapshot*");
 await page.getByRole("button",{name:"重新同步"}).click();
 await page.waitForFunction(()=>document.querySelector("#status")?.textContent==="就绪");
 assert.equal(await page.locator("#send").isDisabled(),false);
 await capture(page,'composer-features.png');
 // Original Harness ExpandButton belongs to the corner seat, outside status utilities.
 const corner=page.locator("[data-conversation-header-corner]");
 await corner.locator("[data-sidebar-right-expand]#show-workbench").waitFor();
 assert.equal(await page.locator(".headerUtilities #show-workbench").count(),0);
 assert.equal(await corner.locator("#show-workbench").isEnabled(),true);
 const cornerRect=await corner.boundingBox();
 const utilityRect=await page.locator("#status").boundingBox();
 assert.ok(cornerRect&&utilityRect&&cornerRect.x>=utilityRect.x+utilityRect.width-1,
   "Harness right-panel control must follow the utility cluster");
 await capture(page,"header-corner.png");
 await page.locator(".pi-welcome-title").waitFor({state:"visible"});

 assert.equal(await page.locator(".pi-mark,.pi-hero-mark").count(),0);
 await capture(page,"hero-animated.png"); // InputBar composition matches upstream row -> tools/trailing group geometry.
 const inputGeometry=await page.evaluate(()=>{
  const row=document.querySelector("[data-composer-controls]");
  const rect=selector=>document.querySelector(selector)?.getBoundingClientRect().toJSON();
  return {align:getComputedStyle(row).justifyContent,width:row.clientWidth,scroll:row.scrollWidth,
   attach:rect("#attach-button"),model:rect("#models"),send:rect("#send"),row:row.getBoundingClientRect().toJSON()};
 });
 assert.equal(inputGeometry.align,"space-between");
 assert.ok(inputGeometry.attach.x<inputGeometry.model.x&&inputGeometry.model.x<inputGeometry.send.x,
   "Harness input tools must precede the model and submit group");
 assert.ok(inputGeometry.scroll<=inputGeometry.width+2,"InputBar must not overflow its own row");
 const composerSurface=await page.locator("#form").evaluate(element=>getComputedStyle(element).boxShadow);
 assert.notEqual(composerSurface,"none","Pi composer must have a visible surface");
 await page.locator("#prompt").click();
 await page.keyboard.insertText("fixture temporary text");
 await page.keyboard.press("Control+A");
 await page.keyboard.press("Backspace");
 await page.waitForFunction(()=>document.querySelector("#prompt")?.hasAttribute("data-empty"));
 const placeholder=await page.locator("#prompt").evaluate(element=>getComputedStyle(element,"::before").content);
 assert.ok(placeholder.includes("描述任务"),"Empty composer must show its prompt"); await capture(page,"harness-input-bar.png"); const viewport={width:await page.evaluate(()=>innerWidth),height:await page.evaluate(()=>innerHeight)};
 await page.setViewportSize({width:720,height:860});
 await page.waitForFunction(()=>innerWidth===720);
 const center=await page.locator("main").evaluate(element=>{const r=element.parentElement.getBoundingClientRect();return {left:r.left,width:r.width};});
 assert.ok(center.left<2&&center.width>680,"narrow conversation must fill the frame");
 await page.locator("#sidebar-open").click();
 await page.locator(".sidebar-backdrop").click();
 await page.locator("#show-workbench").click();
 await page.waitForFunction(()=>{const r=document.querySelector(".inspector")?.getBoundingClientRect();return r&&Math.abs(r.left)<2&&Math.abs(r.width-innerWidth)<2;});
 await capture(page,"narrow.png");
 await page.locator("#rightbar-collapse").click();
 await page.setViewportSize(viewport);
 await page.waitForFunction(width=>innerWidth===width,viewport.width);
 // Session-scoped right tabs: fake only snapshot and session mutations in the isolated browser.
 const baseSnapshot=await page.evaluate(()=>fetch("/api/snapshot").then(response=>response.json()));
 const baseState=baseSnapshot.state;
 const identities=[
  {id:"rightbar-fixture-a",name:"Rightbar fixture A"},
  {id:"rightbar-fixture-b",name:"Rightbar fixture B"}
 ];
 let selectedSession=identities[0].id;
 const sessionState=()=>({...baseState,sessionId:selectedSession});
 await page.route("**/api/snapshot*",route=>route.fulfill({json:{
  ...baseSnapshot,state:sessionState(),sessions:identities,messages:[],dialogs:[],
 }}));
 await page.route("**/api/state",route=>route.fulfill({json:sessionState()}));
 await page.route("**/api/action",route=>{
  const request=route.request().postDataJSON();
  if(request.action==="new"||request.action==="switch"){
   selectedSession=request.action==="new"?identities[1].id:request.value;
   return route.fulfill({json:{}});
  }
  return route.continue();
 });
 await page.reload();
 await page.waitForFunction(()=>document.querySelector("#status")?.textContent==="就绪");
 const tabs=()=>page.locator(".inspector [data-dockkit-tab]").allTextContents();
 await page.locator("#sidebar-panels").getByRole("button",{name:"文件",exact:true}).click();
 await page.locator(".inspector").getByTitle("刷新文件",{exact:true}).waitFor();
 assert.ok((await tabs()).some(label=>label.includes("文件")),"A must own files tab");
 await capture(page,"rightbar-session-a.png");
 await page.locator("#new").click();
 await page.locator("#show-workbench").waitFor();
 await page.locator("#show-workbench").click();
 await page.locator(".inspector").getByTitle("终端",{exact:true}).waitFor();
 assert.ok(!(await tabs()).some(label=>label.includes("文件")),"B must not inherit A files tab");
 await page.locator("#sidebar-panels").getByRole("button",{name:"终端",exact:true}).click();
 await page.locator(".inspector [data-dockkit-tab]").filter({hasText:"终端"}).first().waitFor();
 await capture(page,"rightbar-session-b.png");
 await page.locator("#sessions .session-row").filter({hasText:identities[0].name}).locator(".session-select").click();
 await page.locator("#show-workbench").waitFor();
 assert.equal(await page.locator("body").evaluate(el=>el.classList.contains("workbench-open")),false);
 await page.locator("#show-workbench").click();
 await page.locator(".inspector").getByTitle("刷新文件",{exact:true}).waitFor();
 assert.ok((await tabs()).some(label=>label.includes("文件")),"Returning to A restores its dock");
 assert.ok(!(await tabs()).some(label=>label.includes("终端")),"A must not inherit B terminal");
 await page.locator("#sessions .session-row").filter({hasText:identities[1].name}).locator(".session-select").click();
 await page.locator("#show-workbench").waitFor();
 assert.equal(await page.locator("body").evaluate(el=>el.classList.contains("workbench-open")),false);
 await page.locator("#show-workbench").click();
 await page.locator(".inspector [data-dockkit-tab]").filter({hasText:"终端"}).first().waitFor();
 await page.unroute("**/api/action");
 await page.unroute("**/api/state");
 await page.unroute("**/api/snapshot*");
 await page.reload();
 await page.waitForFunction(()=>document.querySelector("#status")?.textContent==="就绪"); // An unsaved CodeMirror draft must block a Pi session change until confirmed.
 await page.locator("#sidebar-panels").getByRole("button",{name:"文件",exact:true}).click();
 await page.locator('.inspector [data-files-entry="file"][data-files-path="axiom-fixture.txt"] button').click();
 const editor=page.locator(".inspector .cm-content[contenteditable=true]");
 await editor.waitFor();
 await editor.click();
 await page.keyboard.press("Control+End");
 await page.keyboard.insertText(" UNCOMMITTED-UI-TEST");
 await page.waitForFunction(()=>!!document.querySelector(".inspector .wb-bar button:not([disabled])")?.textContent?.includes("保存"));
 let warning="";
 page.once("dialog",async dialog=>{warning=dialog.message();await dialog.dismiss();});
 await page.locator("#new").click();
 await page.waitForFunction(()=>document.querySelector(".inspector .cm-content")?.textContent?.includes("UNCOMMITTED-UI-TEST"));
 assert.match(warning,/未保存/);
 await page.reload();
 await page.waitForFunction(()=>document.querySelector("#status")?.textContent==="就绪"); assert.deepEqual(errors,[]);console.log("HARNESS_UI_RENDER_PASS",JSON.stringify(a));
}finally{await browser.close();}
