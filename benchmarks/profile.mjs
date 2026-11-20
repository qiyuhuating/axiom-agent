import {readFile} from "node:fs/promises";
const file=process.argv[2]||"benchmarks/results/host.cpuprofile";
const p=JSON.parse(await readFile(file,"utf8"));
const nodes=new Map(p.nodes.map(n=>[n.id,n.callFrame]));
const totals=new Map();
for(let i=0;i<p.samples.length;i++){const f=nodes.get(p.samples[i]);const key=f.functionName+" @ "+f.url+":"+(f.lineNumber+1);totals.set(key,(totals.get(key)||0)+(p.timeDeltas[i]||0));}
console.log([...totals].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([name,us])=>({name,ms:us/1000})));
