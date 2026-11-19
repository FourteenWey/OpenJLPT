import { useRef, useState, type FormEvent } from 'react'
import { bookmarkId, getBookmark, removeBookmark, saveBookmark } from '../db/bookmarks'
import type { Bookmark, BookmarkTarget } from '../types'
import { useApp } from './app-context'
import { StudyDialog } from './StudyDialog'
import { StudyIcon } from './StudyIcon'
import { useLoad } from './useLoad'

const titles = { add: '加书签', edit: '编辑书签备注', remove: '移除书签' } as const
const actions = { add: '保存书签', edit: '保存备注', remove: '确认移除' } as const

export function BookmarkDialog({ action, target, label, note = '', onClose }: {
  action: keyof typeof titles
  target: BookmarkTarget
  label: string
  note?: string
  onClose: () => void
}) {
  const { db, bump } = useApp()
  const [draft, setDraft] = useState(note)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const saving = useRef(false)
  const close = () => { if (!saving.current) onClose() }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    try {
      if (action === 'remove') await removeBookmark(db, target)
      else await saveBookmark(db, target, draft, action)
      bump()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return <StudyDialog title={titles[action]} onClose={close}>
    <form className="bookmark-form" onSubmit={submit}>
      <p className="bookmark-target" lang="ja">{label}</p>
      {action === 'remove' ? <p>移除此书签及其备注？</p> : <label>
        备注（可选）
        <textarea data-dialog-focus rows={4} value={draft} disabled={busy}
          onChange={(event) => setDraft(event.target.value)} placeholder="写下容易忘记的地方" />
      </label>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="bookmark-form-actions">
        <button type="button" data-dialog-focus={action === 'remove' ? '' : undefined} disabled={busy} onClick={close}>取消</button>
        <button type="submit" className="primary" disabled={busy}>{actions[action]}</button>
      </div>
    </form>
  </StudyDialog>
}

export function BookmarkButton({ subject, itemId, label, disabled, onDialogChange }: BookmarkTarget & {
  label: string
  disabled?: boolean
  onDialogChange?: (open: boolean) => void
}) {
  const { db, version } = useApp()
  const target = { subject, itemId }
  const id = bookmarkId(target)
  const { data, error } = useLoad(async () => ({ id, bookmark: await getBookmark(db, target) }), [db, version, id])
  const [editor, setEditor] = useState<{ id: string; bookmark?: Bookmark }>()
  const current = data?.id === id ? data : undefined
  const bookmark = current?.bookmark

  return <>
    <button className="link bookmark-control" data-saved={bookmark ? '' : undefined} disabled={disabled || !current}
      aria-haspopup="dialog" title={bookmark ? '编辑书签备注' : undefined} onClick={(event) => {
        event.currentTarget.focus()
        setEditor(current)
        onDialogChange?.(true)
      }}>
      <StudyIcon name="bookmark" /> {bookmark ? '已加书签' : '加书签'}
    </button>
    {error && <span className="error small" role="status">暂时无法读取书签。</span>}
    {editor?.id === id && <BookmarkDialog action={editor.bookmark ? 'edit' : 'add'} target={target}
      label={label} note={editor.bookmark?.note} onClose={() => {
        setEditor(undefined)
        onDialogChange?.(false)
      }} />}
  </>
}
