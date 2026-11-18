import {runtimeToken,runtimeUrl} from '../src/runtime-auth.mjs';
const res=await fetch(runtimeUrl+'/api/runtime-stop',{method:'POST',headers:{Authorization:'Bearer '+runtimeToken,'Content-Type':'application/json'},body:'{}'});
if(!res.ok)throw Error(await res.text());
console.log('Runtime stop requested.');
