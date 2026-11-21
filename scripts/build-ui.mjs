import {build} from 'esbuild';
await build({
 entryPoints:{app:'ui/app.tsx'},
 bundle:true,minify:true,format:'esm',jsx:'automatic',splitting:true,chunkNames:'chunks/[name]-[hash]',outdir:process.argv[2]||'public',logLevel:'info',
});
