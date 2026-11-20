export type ActiveAtToken={prefix:string;query:string;quoted:boolean};
export type FileReferenceCandidate={path:string;kind:"file"|"directory"};
export type TriggerChar="/"|"@";
export type DetectTrigger=(draft:string,caret:number,guard:{tier:"plain"|"claimed"|"frozen"})=>{trigger:TriggerChar;query:string;quoted:boolean;position:"leading"|"inline";span:{start:number;end:number;draftRev:number}}|null;
