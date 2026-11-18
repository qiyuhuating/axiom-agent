import React from 'react';
export async function api(path:string,data?:unknown){
 const r=await fetch('/api/'+path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Axiom-Client':'1'},body:JSON.stringify(data)});
 const value=await r.json();if(!r.ok)throw Error(value.error||r.statusText);return value;
}
export const terminalAction=(action:string,value?:unknown)=>api('terminal-action',{action,value});
export const msg=(e:unknown)=>e instanceof Error?e.message:String(e);
export const errorBox=(error:string)=>error?<p className="wb-error" role="alert">{error}</p>:null;
export function Header({children}:React.PropsWithChildren){return <div className="wb-bar">{children}</div>;}
export const dirtyTabs=new Set<string>();
