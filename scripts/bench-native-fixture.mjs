import { SessionManager } from "@earendil-works/pi-coding-agent";
if(!process.env.AXIOM_BENCH_WORKSPACE||!process.env.AXIOM_BENCH_FIXTURE) throw Error("Benchmark fixture paths required");
const manager=SessionManager.create(process.env.AXIOM_BENCH_WORKSPACE,process.env.AXIOM_BENCH_FIXTURE);
const time=Date.now()-200000;
const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
const records=Number(process.env.AXIOM_BENCH_RECORDS || 2000);
if(!Number.isInteger(records)||records<80||records%4)throw Error("Expected record count divisible by four");
for(let i=0;i<records;i++){
  const timestamp=time+i;
  const text="Native release fixture "+i+"\n"+"A representative history line.\n".repeat(5);
  if(i%2===0) manager.appendMessage({role:"user",content:text,timestamp});
  else {
    const content=[{type:"text",text}];
    if(i%4===1)content.push({type:"toolCall",id:"fixture-tool-"+i,name:"read",arguments:{path:"fixture.txt"}});
    manager.appendMessage({role:"assistant",content,timestamp,api:"openai-completions",provider:"fixture",model:"fixture",stopReason:i%4===1?"toolUse":"stop",usage});
    if(i%4===1)manager.appendMessage({role:"toolResult",toolCallId:"fixture-tool-"+i,toolName:"read",content:[{type:"text",text:"x".repeat(4096)}],isError:false,timestamp});
  }
}
console.log("FIXTURE",manager.getSessionId(),manager.getEntries().length);
