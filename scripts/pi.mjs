import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {config,root} from '../src/config.mjs';
const cli=resolve(root,'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
const child=spawn(process.execPath,[cli,...process.argv.slice(2)],{cwd:config.workspace,stdio:'inherit',env:process.env});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});
child.on('exit',(code)=>{process.exitCode=code??1;});
