import {resolve} from 'node:path';
import {config,root} from './config.mjs';
const dir=process.env.AXIOM_JOB_DIR,temp=process.env.AXIOM_JOB_TEMP_ROOT;
if(process.platform!=='win32'||!dir||!temp)throw Error('Windows ACL worker requires private job and temporary directories');
const cli=resolve(root,'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
process.argv=[process.execPath,resolve(root,'vendor/dsh/native/acl-runner.mjs'),'--workspace',dir,'--temp',temp,'--mode','workspace-write','--',process.execPath,cli,...process.argv.slice(2)];
await import('../vendor/dsh/native/acl-runner.mjs');
