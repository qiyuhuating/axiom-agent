import { realpath, readdir, stat, readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname, basename, sep, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.mjs';
const exec = promisify(execFile);
const digest = data=>createHash('sha256').update(data).digest('hex');
export function contains(base,path){const rel=relative(base,path);return rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep));}
export async function workspacePath(path=''){
  if(typeof path!=='string'||isAbsolute(path)||path.includes('\0'))throw Error('Invalid workspace path');
  const base=await realpath(config.workspace), target=resolve(base,path);
  if(!contains(base,target))throw Error('Outside workspace');
  const actual=await realpath(target);
  if(!contains(base,actual))throw Error('Outside workspace');
  return actual;
}
export async function listFiles(path=''){
  const directory=await workspacePath(path);
  const entries=await readdir(directory,{withFileTypes:true});
  return entries.filter(e=>e.name!=='.git').map(e=>({name:e.name,path:[path,e.name].filter(Boolean).join('/'),meta:{kind:e.isDirectory()?'directory':e.isFile()?'file':'other',hidden:e.name.startsWith('.')}}));
}
const mimeTypes={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.bmp':'image/bmp','.pdf':'application/pdf'};
export async function openFile(path){
  const file=await workspacePath(path), info=await stat(file);
  if(!info.isFile()||info.size>10*1024*1024)throw Error('Not a file or exceeds 10 MiB preview limit');
  const data=await readFile(file),mime=mimeTypes[extname(file).toLowerCase()];
  if(mime)return {kind:'media',mime,data:data.toString('base64'),size:data.length};
  if(data.length>1024*1024||data.includes(0))return {kind:'binary',size:data.length};
  let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data);}catch{return {kind:'binary',size:data.length};}
  return {kind:'text',text,revision:digest(data),size:data.length};
}
export async function saveFile({path,text,revision}){
  if(typeof text!=='string'||Buffer.byteLength(text)>1024*1024||typeof revision!=='string')throw Error('Invalid editor payload');
  const file=await workspacePath(path),before=await readFile(file);
  if(digest(before)!==revision)throw Error('File changed on disk. Reopen before saving.');
  const temp=resolve(dirname(file),'.axiom-'+randomUUID()+'.tmp');
  try{
    await writeFile(temp,text,{flag:'wx',mode:(await stat(file)).mode});
    if(digest(await readFile(file))!==revision)throw Error('File changed on disk. Reopen before saving.');
    await rename(temp,file);
  }finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  return {revision:digest(Buffer.from(text))};
}
export async function gitDiff(){
  const run=args=>exec('git',args,{cwd:config.workspace,encoding:'utf8',maxBuffer:4*1024*1024,windowsHide:true});
  try{await run(['rev-parse','--is-inside-work-tree']);}catch(e){if(e.code===128)return {available:false,reason:'Workspace is not a Git repository'};throw e;}
  const [status,unstaged,staged]=await Promise.all([run(['status','--short','--','.' ]),run(['diff','--no-ext-diff','--no-color','--','.']),run(['diff','--cached','--no-ext-diff','--no-color','--','.'])]);
  return {available:true,status:status.stdout,unstaged:unstaged.stdout,staged:staged.stdout};
}
export async function upload({name,data}){
  if(typeof name!=='string'||!name||name!==basename(name)||name.includes('/')||name.includes('\\')||/[<>:"|?*\x00-\x1f]/.test(name)||typeof data!=='string')throw Error('Invalid attachment');
  const bytes=Buffer.from(data,'base64');
  if(bytes.length>8*1024*1024)throw Error('Attachment exceeds 8 MiB');
  const base=await realpath(config.workspace),folder=resolve(base,'.axiom-attachments');
  await mkdir(folder,{recursive:true});
  if(!contains(base,await realpath(folder)))throw Error('Invalid attachments directory');
  const safe=randomUUID()+'-'+name;
  await writeFile(resolve(folder,safe),bytes,{flag:'wx'});
  return {path:'.axiom-attachments/'+safe,name,size:bytes.length};
}
