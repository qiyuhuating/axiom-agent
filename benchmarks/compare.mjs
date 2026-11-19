import { readFile } from "node:fs/promises";
const [oldFile,newFile]=process.argv.slice(2);
if(!oldFile||!newFile)throw Error("Usage: node benchmarks/compare.mjs <baseline.json> <candidate.json>");
const [a,b]=await Promise.all([oldFile,newFile].map(async f=>JSON.parse(await readFile(f,"utf8"))));
if(a.profile||b.profile||a.cpu!==b.cpu||a.os!==b.os||a.node!==b.node||a.samples!==b.samples)throw Error("Use matching hardware, OS, Node and unprofiled sample counts");
const rows=[];
for(const kind of Object.keys(a.scenarios)){
 for(const [name,old] of Object.entries(a.scenarios[kind])){
  if(!old?.p50)continue;
  const next=b.scenarios[kind][name];
  rows.push({scenario:kind,metric:name,oldP50:old.p50.toFixed(3),newP50:next.p50.toFixed(3),p50Change:((next.p50/old.p50-1)*100).toFixed(1)+"%",oldP99:old.p99.toFixed(3),newP99:next.p99.toFixed(3),p99Change:((next.p99/old.p99-1)*100).toFixed(1)+"%"});
 }
}
console.table(rows);
