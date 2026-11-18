import {RpcClient} from '@earendil-works/pi-coding-agent';
// Pi 1.5.2's public RpcClient handles all regular commands but lacks the
// extension-ui one-way response API. Its JS process field is used only here.
// Keep pinned and verify when upgrading Pi. Never use send(), which waits
// for a response that this protocol intentionally does not produce.
export class PiClient extends RpcClient {
  respond(record){
    const stdin=this.process?.stdin;
    if(!stdin?.writable)throw Error('Pi RPC stdin unavailable');
    return new Promise((resolve,reject)=>stdin.write(JSON.stringify(record)+'\n',error=>error?reject(error):resolve()));
  }
}
