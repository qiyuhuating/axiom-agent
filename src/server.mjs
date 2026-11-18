import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Agent } from './agent.mjs';
import { config, root } from './config.mjs';
import {listFiles,openFile,saveFile,gitDiff,upload} from './workspace.mjs';
import {permission,setPermission,inventory,resourceAction,providers,providerAction} from './settings.mjs';
import {proxyRuntime,ensureRuntime} from './runtime-client.mjs';

const agent = new Agent();
const assets = new Map([['/', ['index.html','text/html']], ['/app.js',['app.js','text/javascript']], ['/style.css',['style.css','text/css']], ['/markdown.mjs',['../node_modules/markdown-it/dist/browser/markdown-it.esm.min.mjs','text/javascript']], ['/dsh-ui.js',['dsh-ui.js','text/javascript']], ['/dsh-ui.css',['dsh-ui.css','text/css']], ['/workbench.js',['workbench.js','text/javascript']], ['/workbench.css',['workbench.css','text/css']]]);
function json(res, data, status = 200) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data));
}
async function body(req) {
  let result = '', bytes=0; req.setEncoding('utf8');
  for await (const chunk of req) { bytes += Buffer.byteLength(chunk); if (bytes > 96 * 1024 * 1024) throw new Error('Request too large'); result += chunk; }
  return JSON.parse(result);
}
const server = createServer(async (req, res) => {
  const host = req.headers.host;
  if (host !== '127.0.0.1:' + config.port && host !== 'localhost:' + config.port) return json(res, {error:'Invalid host'}, 403);
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src http: https: blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const url = new URL(req.url, 'http://localhost'); const path=url.pathname;
  try {
    if (req.method === 'GET') {
      if (/^\/chunks\/[A-Za-z0-9_-]+\.(js|css)$/.test(path)) {
        const data=await readFile(resolve(root,'public',path.slice(1)));
        res.writeHead(200,{'Content-Type':path.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'public,max-age=31536000,immutable'});return res.end(data);
      }
      if (assets.has(path)) {
        const [file, type] = assets.get(path);
        res.writeHead(200, {'Content-Type':type+'; charset=utf-8','Cache-Control':'no-cache'});
        return res.end(await readFile(resolve(root,'public',file)));
      }
      if (path === '/api/health') return json(res,{ok:true});
      if (path === '/api/state') return json(res,await agent.state());
      if (path === '/api/messages') return json(res,await agent.messages());
      if (path === '/api/models') return json(res,await agent.models());
      if (path === '/api/levels') return json(res,await agent.levels());
      if (path === '/api/sessions') return json(res,await agent.sessions());
      if(path==='/api/files')return json(res,await listFiles(url.searchParams.get('path')??''));
      if(path==='/api/file')return json(res,await openFile(url.searchParams.get('path')??''));
      if(path==='/api/diff')return json(res,await gitDiff());
      if(path==='/api/session-details')return json(res,await agent.sessionDetails());
      if(path==='/api/commands')return json(res,await agent.commands());
      if(path==='/api/dialogs')return json(res,agent.pendingDialogs());
      if(path==='/api/settings')return json(res,{permission:await permission(),maxOutputTokens:config.maxOutputTokens??null,discoverContext:config.discoverContext??false,workspace:config.workspace});
      if(path==='/api/providers')return json(res,await providers());
      if(path==='/api/resources')return json(res,await inventory());
      if(['/api/jobs','/api/terminals','/api/terminal/events','/api/runtime-health'].includes(path))return await proxyRuntime(req,res);
      if (path === '/api/events') {
        await agent.start();
        res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive'});
        res.flushHeaders();
        res.write(': ready\n\n');
        const off = agent.subscribe(event => { if (res.writableLength > 4 * 1024 * 1024) res.destroy(); else res.write('data: '+JSON.stringify(event)+'\n\n'); });
        void agent.start().catch(error=>res.write('data: '+JSON.stringify({type:'connection_error',error:error.message})+'\n\n'));
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
        res.on('close', () => { off(); clearInterval(heartbeat); });
        return;
      }
    }
    if(req.method==='POST'&&path.startsWith('/api/')){
      if(req.headers.origin!=='http://'+host||req.headers['x-axiom-client']!=='1')return json(res,{error:'Invalid origin'},403);
      if(path==='/api/file-save')return json(res,await saveFile(await body(req)));
      if(path==='/api/upload')return json(res,await upload(await body(req)));
      if(path==='/api/ui-response')return json(res,await agent.respond(await body(req)));
      if(path==='/api/permission'){if(agent.busy)throw Error('Stop the agent before changing permissions');return json(res,await setPermission((await body(req)).mode));}
      if(path==='/api/provider-action'){if(agent.busy)throw Error('Stop the agent before changing providers');return json(res,await providerAction(await body(req)));}
      if(path==='/api/resource-action'){if(agent.busy)throw Error('Stop the agent before changing resources');return json(res,await resourceAction(await body(req)));}
      if(['/api/terminal-action','/api/job-action'].includes(path))return await proxyRuntime(req,res,await body(req));
    }
    if (req.method === 'POST' && path === '/api/action') {
      if (req.headers.origin !== 'http://'+host || req.headers['x-axiom-client'] !== '1') return json(res,{error:'Invalid origin'},403);
      const { action, value, images } = await body(req);
      if (action === 'prompt' || action === 'steer' || action === 'followUp') {
        if (typeof value !== 'string' || !value.trim()) return json(res,{error:'Empty input'},400);
        if(images!==undefined&&(!Array.isArray(images)||images.length>8||images.some(i=>i.type!=='image'||!['image/png','image/jpeg','image/webp','image/gif'].includes(i.mimeType)||typeof i.data!=='string'||i.data.length>12*1024*1024)))throw Error('Invalid image attachments');
        return json(res, await agent[action](value,images));
      }
      if(action==='clear-queue')return json(res,await agent.clearQueue());
      if (action === 'abort') { await agent.abort(); return json(res,{ok:true}); }
      return json(res, await agent.change(action,value) ?? {ok:true});
    }
    return json(res,{error:'Not found'},404);
  } catch (error) { if (!res.headersSent) json(res,{error:error.message},400); else res.destroy(); }
});
server.listen(config.port,'127.0.0.1',()=>{console.log('Axiom Agent http://127.0.0.1:'+config.port);void ensureRuntime().catch(e=>console.error(e.message));});
async function shutdown() { await agent.close(); server.close(); process.exit(0); }
process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);
