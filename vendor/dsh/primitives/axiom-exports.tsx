import {File, FileCode, FileImage, FileText, FolderClosed, FolderOpen, X, Plus, PanelLeft, CircleX} from 'lucide-react';
export {focusWithoutRing} from './focus.ts';
export {modalSelector} from './useModalLayer.ts';
export {observeComposition} from './keyboard-composition.ts';
export {Tooltip} from './Tooltip.tsx';
export {MenuSurface} from './MenuSurface.tsx';
export {FolderClosed as IconFolderCloseRegular,FolderOpen as IconFolderOpenRegular,X as IconCloseOutlineRegular,Plus as IconPlusOutlineRegular,PanelLeft as IconPanelLeftOutlineRegular,CircleX as IconCloseFillRegular};
export function classifyFileType(name:string){
 const ext=name.split('.').pop()?.toLowerCase()||'';
 if(['png','jpg','jpeg','webp','gif','bmp','svg'].includes(ext))return 'image';
 if(['js','ts','tsx','jsx','go','rs','py','json','html','css','sql','java','c','cpp','h'].includes(ext))return 'code';
 if(['md','txt','log','pdf','docx'].includes(ext))return 'text';return 'other';
}
export function FileTypeIcon({kind,...props}:{kind:string,size?:number,className?:string}){const Icon=kind==='image'?FileImage:kind==='code'?FileCode:kind==='text'?FileText:File;return <Icon {...props} strokeWidth={1.7}/>;}

export {StateDot,type StateDotState} from './StateDot.tsx';
export {ListChecks as IconChecklistOutlineRegular,ChevronDown as IconChevronDownOutlineRegular,ChevronUp as IconChevronUpOutlineRegular} from 'lucide-react';
