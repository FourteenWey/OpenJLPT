import type { Bookmark, BookmarkTarget, StudySubject } from '../types'
import { getAll, getOne, req, run } from './db'

export const bookmarkId = ({ subject, itemId }: BookmarkTarget) => `${subject}:${itemId}`

export const getBookmark = (db: IDBDatabase, target: BookmarkTarget) => getOne<Bookmark>(db, 'bookmarks', bookmarkId(target))

export async function listBookmarks(db: IDBDatabase, subject: StudySubject): Promise<Bookmark[]> {
  return (await getAll<Bookmark>(db, 'bookmarks'))
    .filter((bookmark) => bookmark.subject === subject)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id))
}

export function saveBookmark(db: IDBDatabase, target: BookmarkTarget, note: string, action: 'add' | 'edit', now = new Date()): Promise<Bookmark> {
  return run(db, ['bookmarks'], 'readwrite', async (tx) => {
    const store = tx.objectStore('bookmarks')
    const id = bookmarkId(target)
    const existing = (await req(store.get(id))) as Bookmark | undefined
    if (action === 'add' && existing) return existing
    if (action === 'edit' && !existing) throw new Error('这条书签已移除。')
    const updatedAt = now.toISOString()
    const bookmark: Bookmark = {
      subject: target.subject,
      itemId: target.itemId,
      id,
      note: note.trim(),
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt,
    }
    await req(store.put(bookmark))
    return bookmark
  })
}

export const removeBookmark = (db: IDBDatabase, target: BookmarkTarget): Promise<void> =>
  run(db, ['bookmarks'], 'readwrite', async (tx) => {
    await req(tx.objectStore('bookmarks').delete(bookmarkId(target)))
  })
