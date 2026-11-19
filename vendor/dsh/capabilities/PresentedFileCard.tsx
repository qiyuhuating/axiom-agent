import type {HTMLAttributes} from 'react'
type ContextMenuTriggerProps=HTMLAttributes<HTMLButtonElement>
/** File identity, Sidebar preview, and contributed native actions for one delivery. */
import type { ReactNode } from 'react'
const resolveWorkspacePath = (_cwd:string|undefined,path:string)=>path
import { FileTypeIcon, classifyFileType } from '../primitives/axiom-exports.tsx'
const fileExtension=(name:string)=>name.includes('.')?name.split('.').at(-1)!:''
type PropsLocale<T>={t:(key:string,args?:{name?:string})=>string}
type PresentedHost={fileManager:'directory'|'file'}
type PresentedOpenPhase='error'|'revealError'|'nativeUnavailable'|'revealing'
type PresentedPath={path:string;description?:string}
const basename=(path:string)=>path.split('/').at(-1)??path
type NS='deliverables'
import css from './Deliverables.module.css'

function cardDescription(description: string | undefined, fallback: string): string {
  const trimmed = description?.replace(/\s*(?:\([^()]*\)|（[^（）]*）)\s*$/u, '').trim()
  return trimmed === undefined || trimmed === '' ? fallback : trimmed
}

/**
 * Render independent file actions without nesting buttons inside a clickable card.
 * @param props - durable file metadata, Sidebar preview, Host capabilities, gesture status, and localized copy.
 * @returns the file card and its anchored action menu.
 */
export function PresentedFileCard({ file, cwd, phase, host, onPreview, contextMenuProps, actions, t }: {
  file: PresentedPath
  cwd: string | undefined
  phase: PresentedOpenPhase | undefined
  host: PresentedHost | null
  onPreview: () => void
  contextMenuProps: ContextMenuTriggerProps
  actions: ReactNode
} & PropsLocale<NS>) {
  const reveal = host?.fileManager ?? 'directory'
  const name = basename(file.path)
  const metadata = fileExtension(name).toUpperCase() || t('presented.file')
  const status = phase === undefined
    ? cardDescription(file.description, metadata)
    : t(reveal === 'directory' && phase === 'revealing' ? 'presented.directoryOpening'
      : reveal === 'directory' && phase === 'revealError' ? 'presented.directoryError' : `presented.${phase}`)
  return <div className={css.file} data-presented-file>
    <button type="button" className={css.cardPreview} title={resolveWorkspacePath(cwd, file.path)}
      aria-label={t('presented.previewCard', { name: file.path })} onClick={onPreview}
      {...contextMenuProps} />
    <span className={css.fileIcon}><FileTypeIcon kind={classifyFileType(file.path)} size={20} /></span>
    <div className={css.fileBody}>
      <div className={css.details}>
        <span className={css.fileName}>{name}</span>
        <span className={css.description} data-presented-description role={phase === undefined ? undefined : 'status'}
          data-error={phase === 'error' || phase === 'revealError' || phase === 'nativeUnavailable' ? true : undefined}>
          <span className={css.secondaryText}>
            {status}
          </span>
          <span className={css.previewHint}>{t('presented.preview')}</span>
        </span>
      </div>
      <div className={css.actions}>{actions}</div>
    </div>
  </div>
}
