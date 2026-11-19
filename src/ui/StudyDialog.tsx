import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { StudyIcon } from './StudyIcon'

export function StudyDialog({ title, className = '', onClose, closeOn, children }: {
  title: string
  className?: string
  onClose: () => void
  closeOn?: (event: KeyboardEvent<HTMLDialogElement>) => boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useLayoutEffect(() => {
    const dialog = ref.current!
    const previous = document.activeElement as HTMLElement | null
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    const initialFocus = dialog.querySelector<HTMLElement>('[data-dialog-focus]') ?? dialog.querySelector('button')
    initialFocus?.focus()
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  return <dialog ref={ref} className={`study-dialog ${className}`} aria-label={title} aria-modal="true"
    onCancel={(e) => { e.preventDefault(); onClose() }}
    onKeyDown={(e) => { if (e.key === 'Escape' || closeOn?.(e)) { e.preventDefault(); onClose() } }}
    onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div className="dialog-content">
      <header className="dialog-heading">
        <h2>{title}</h2>
        <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}><StudyIcon name="close" /></button>
      </header>
      {children}
    </div>
  </dialog>
}
