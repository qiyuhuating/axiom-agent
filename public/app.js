import MarkdownIt from '/markdown.js';
import {renderSessions,controlIcon,layout} from '/dsh-ui.js';
import {initWorkbench,extensionEvent,syncDialogs,attachmentPayload,clearAttachments} from '/workbench.js';
const markdown = new MarkdownIt({ html:false, linkify:true }).disable('image');
const $ = id => document.getElementById(id);
const transcript = $('transcript'), trace = $('trace');
let busy = false, current = null, activeMessage = null, synchronizing = true, scrollPending = false;
const tools = new Map();
let sessionList = [], changing = false, refreshing = 0;
function renderSessionList(){renderSessions({sessions:sessionList,current,disabled:busy||synchronizing||changing,onSelect:id=>run(()=>changeSession('switch',id)),onDelete:id=>changeSession('delete',id)});}
async function changeSession(kind,value){
  if(busy||changing||synchronizing)throw Error('当前正在执行任务或同步会话。');
  changing=true;setBusy(busy);
  try { const r=await action(kind,value); if(kind==='fork'&&!r.cancelled&&typeof r.text==='string')$('prompt').value=r.text; if(r.cancelled)throw Error('Pi 取消了会话操作。'); }
  finally { try{await refresh();}finally{changing=false;setBusy(busy);} }
  await loadOptions();
}
layout();window.addEventListener('resize',layout);
controlIcon('new','new','新建会话');controlIcon('stop','stop','停止');controlIcon('trace-heading','trace','执行轨迹');
const api = async (path, data) => {
  const response = await fetch('/api/'+path, data === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json','X-Axiom-Client':'1'},body:JSON.stringify(data)});
  const value = await response.json();
  if (!response.ok) throw Error(value.error);
  return value;
};
const action = (action,value,images) => api('action',{action,value,...(images?.length?{images}:{})});
initWorkbench();
function error(e) { $('error').textContent = e?.message || String(e || ''); }
function setBusy(value) {
  busy = value;
  $('status').textContent = value ? '运行中' : '就绪';
  $('stop').disabled = !value; $('send').disabled=synchronizing||changing; controlIcon('send','send',value?'引导':'发送');
  for (const id of ['new','models','levels','session-actions']) $(id).disabled = value || synchronizing || changing;
  renderSessionList();
}
function scroll() { if(scrollPending)return; scrollPending=true; requestAnimationFrame(()=>{scrollPending=false; transcript.scrollTop=transcript.scrollHeight;}); }
function message(role, text, finalized = true) {
  transcript.querySelector('.welcome')?.remove();
  const article = document.createElement('article'); article.className=role;
  const label=document.createElement('b'); label.textContent=role==='user'?'你':'Axiom';
  const content=document.createElement('div'); if(role==='assistant' && finalized){content.className='markdown';content.innerHTML=markdown.render(text);}else{content.textContent=text;}
  article.append(label,content); transcript.append(article); scroll(); return content;
}
function textOf(content) {
  if (typeof content==='string') return content;
  return (content || []).filter(x=>x.type==='text').map(x=>x.text).join('\n');
}
function showTool(id,name,args,result,failed,finished) {
  let item=tools.get(id);
  if (!item) {
    const node=document.createElement('details'), title=document.createElement('summary'), pre=document.createElement('pre');
    node.append(title,pre); trace.append(node); item={title,pre,args}; tools.set(id,item);
  }
  item.title.textContent=(finished?(failed?'失败 · ':'完成 · '):'运行 · ')+name;
  item.pre.textContent=JSON.stringify({arguments:args??item.args,result},null,2);
}
function renderHistory(messages) {
  transcript.replaceChildren(); trace.replaceChildren(); tools.clear(); activeMessage=null;
  if (!messages.length) {const div=document.createElement('div');div.className='welcome';const h=document.createElement('h1');h.textContent='今天构建什么？';const p=document.createElement('p');p.textContent='分析代码、实现功能、验证工程，或处理通用任务。';div.append(h,p);transcript.append(div);}
  for(const m of messages) {
    if(m.role==='user'||m.role==='assistant') {
      const text=textOf(m.content); if(text || m.errorMessage) message(m.role,text||m.errorMessage);
      if(Array.isArray(m.content)) for(const c of m.content) if(c.type==='toolCall') showTool(c.id,c.name,c.arguments,undefined,false,false);
    } else if(m.role==='toolResult') showTool(m.toolCallId,m.toolName,undefined,m.content,m.isError,true);
  }
}
async function refresh() { const generation=++refreshing; synchronizing=true;setBusy(busy);try{
  const [state,messages,sessions]=await Promise.all([api('state'),api('messages'),api('sessions')]);
  if(generation!==refreshing)return;
  const switched=current!==state.sessionId;current=state.sessionId;if(switched)window.dispatchEvent(new Event('axiom:session')); $('workspace').textContent=state.workspace; setBusy(state.busy);
  renderHistory(messages);
  sessionList=sessions;renderSessionList();
  if(state.model) $('models').value=JSON.stringify(state.model);
  $('levels').value=state.thinkingLevel;
}finally{if(generation===refreshing){synchronizing=false;setBusy(busy);}}
}
async function loadOptions() {
  const [models,levels,state]=await Promise.all([api('models'),api('levels'),api('state')]);
  $('models').replaceChildren(new Option('选择已配置模型',''));
  for(const m of models) $('models').append(new Option(m.provider+' / '+m.id,JSON.stringify({provider:m.provider,id:m.id})));
  $('levels').replaceChildren(...levels.map(l=>new Option(l,l)));
  if(state.model) $('models').value=JSON.stringify(state.model);
  $('levels').value=state.thinkingLevel;
}
async function run(fn) { error(''); try{await fn();}catch(e){error(e);} }
const events=new EventSource('/api/events');
events.onopen=()=>run(async()=>{await syncDialogs();await refresh();await loadOptions();});
events.onerror=()=>{$('status').textContent='连接中断';};
events.onmessage=({data})=>{
  const e=JSON.parse(data);
  if(typeof e.busy==='boolean' && e.busy!==busy) setBusy(e.busy);
  if(e.type==='message_start'&&e.message.role==='assistant')activeMessage=null;
  if(e.type==='message_end'){
    const m=e.message;
    if(m.role==='user')message('user',textOf(m.content));
    if(m.role==='assistant'){
      const text=textOf(m.content);
      if(activeMessage){activeMessage.className='markdown';activeMessage.innerHTML=markdown.render(text);}
      else if(text)message('assistant',text);
      if(m.errorMessage)error(m.errorMessage);
      activeMessage=null;
    }
  }
  if(e.type==='message_update'&&e.assistantMessageEvent.type==='text_delta'){
    if(!activeMessage){activeMessage=message('assistant','',false);activeMessage.append(document.createTextNode(''));}
    activeMessage.firstChild.appendData(e.assistantMessageEvent.delta);scroll();
  }
  if(e.type.startsWith('tool_execution_'))showTool(e.toolCallId,e.toolName,e.args,e.result??e.partialResult,e.isError,e.type==='tool_execution_end');
  if(e.type==='agent_settled')run(refresh);
  if(e.type==='state_changed'&&!changing)run(async()=>{await refresh();await loadOptions();});
  if(e.type==='extension_ui_request'||e.type==='ui_closed')extensionEvent(e);
};
$('form').onsubmit=e=>{e.preventDefault();const text=$('prompt').value.trim(),attachment=attachmentPayload();if((!text&&!attachment.suffix&&!attachment.images.length)||synchronizing||changing)return;run(async()=>{const value=[text,attachment.suffix].filter(Boolean).join('\n')||'请分析所附图片。';await action(busy?$('queue-mode').value:'prompt',value,attachment.images);if($('prompt').value.trim()===text)$('prompt').value='';clearAttachments();});};
$('prompt').onkeydown=e=>{if(e.ctrlKey&&e.key==='Enter')$('form').requestSubmit();};
$('stop').onclick=()=>run(async()=>{await action('abort');await refresh();});
$('new').onclick=()=>run(()=>changeSession('new'));
$('models').onchange=()=>run(async()=>{if($('models').value){await action('model',JSON.parse($('models').value));await loadOptions();}});
$('levels').onchange=()=>run(()=>action('thinking',$('levels').value));



$('session-actions').onclick=()=>run(async()=>{const detail=await api('session-details');const choice=window.prompt('Pi: rename / clone / fork / compact / stats / auto-compaction / auto-retry / steering-mode / follow-up-mode','stats');if(!choice)return;if(choice==='stats'){window.alert(JSON.stringify(detail.stats,null,2));return;}if(choice==='rename'){const name=window.prompt('Session name');if(name?.trim())await changeSession('rename',name);return;}if(choice==='fork'){const i=window.prompt(detail.forks.map((m,i)=>(i+1)+': '+m.text.slice(0,100)).join('\n'));const f=detail.forks[Number(i)-1];if(f&&window.confirm('Fork from selected message?'))await changeSession('fork',f.entryId);return;}if(choice==='clone'||choice==='compact'){if(window.confirm(choice+' current session?'))await changeSession(choice);return;}if(['auto-compaction','auto-retry'].includes(choice)){const v=window.prompt('true / false');if(['true','false'].includes(v))await changeSession(choice,v==='true');return;}if(['steering-mode','follow-up-mode'].includes(choice)){const v=window.prompt('all / one-at-a-time');if(v)await changeSession(choice,v);return;}throw Error('Unknown Pi command');});
