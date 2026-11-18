import {build} from 'esbuild';
await build({
 entryPoints:{'dsh-ui':'ui/dsh-ui.tsx',workbench:'ui/workbench.tsx',markdown:'ui/markdown.ts'},
 bundle:true,minify:true,format:'esm',jsx:'automatic',splitting:true,chunkNames:'chunks/[name]-[hash]',outdir:process.argv[2]||'public',logLevel:'info',
});
