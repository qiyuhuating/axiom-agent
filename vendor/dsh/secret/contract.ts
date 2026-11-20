export type UserTextNode<T extends 'secret'> = {readonly id:T;readonly start:number;readonly end:number;readonly data:{readonly masked:string}};
export type UserTextNodeProps<T extends 'secret'> = {node:UserTextNode<T>;raw:string;interactive:boolean};
