import { useState, type MouseEvent } from 'react'
import { listBookmarks } from '../db/bookmarks'
import { getWords } from '../db/wordlists'
import { meaningText } from '../lib/exports'
import { grammarById } from '../lib/grammar'
import { grammarQuestions } from '../lib/grammarQuiz'
import type { Bookmark, StudySubject } from '../types'
import { useApp } from './app-context'
import { BookmarkDialog } from './BookmarkControls'
import { fmtTime } from './format'
import { StudyIcon } from './StudyIcon'
import { useLoad } from './useLoad'

export function BookmarksScreen({ subject }: { subject: StudySubject }) {
  const { db, version } = useApp()
  const { data, error } = useLoad(async () => {
    const bookmarks = await listBookmarks(db, subject)
    const words = subject === 'vocabulary' ? await getWords(db, bookmarks.map((bookmark) => bookmark.itemId)) : []
    return { bookmarks, words: new Map(words.map((word) => [word.id, word])) }
  }, [db, version, subject])
  const [editor, setEditor] = useState<{ action: 'edit' | 'remove'; bookmark: Bookmark; label: string }>()
  if (!data) return <p className={error ? 'error' : 'muted'} role={error ? 'alert' : 'status'}>{error || '正在读取书签…'}</p>

  return <section className="panel" aria-labelledby="bookmarks-heading">
    <div className="bookmarks-heading">
      <h2 id="bookmarks-heading">{subject === 'grammar' ? '语法书签' : '单词书签'}</h2>
      <span className="muted small">{data.bookmarks.length} 条</span>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {data.bookmarks.length === 0 ? <p className="empty-note">还没有书签。答题时收藏的内容和备注会出现在这里。</p> :
      <ul className="cards bookmark-list">
        {data.bookmarks.map((bookmark) => {
          const word = data.words.get(bookmark.itemId)
          const point = subject === 'grammar' ? grammarById.get(bookmark.itemId) : undefined
          const question = point && grammarQuestions.get(point.id)
          const label = word?.word ?? point?.pattern ?? bookmark.itemId
          const level = word?.level ?? point?.level
          const open = (action: 'edit' | 'remove') => (event: MouseEvent<HTMLButtonElement>) => {
            event.currentTarget.focus()
            setEditor({ action, bookmark, label })
          }
          return <li key={bookmark.id}>
            <div className="bookmark-entry-heading">
              <StudyIcon name="bookmark" />
              <h3 lang={word || point ? 'ja' : undefined}>{label}</h3>
              {level && <span className="badge">{level}</span>}
              <time className="muted small" dateTime={bookmark.createdAt}>{fmtTime(bookmark.createdAt)}</time>
            </div>
            <p className={bookmark.note ? 'bookmark-note' : 'muted small'}>{bookmark.note || '暂无备注'}</p>
            {word || point ? <details className="disclosure">
              <summary>{word ? '查看读音与释义' : '查看题目与解析'}</summary>
              {word && <><p lang="ja">{word.reading}</p><p>{meaningText(word)}</p></>}
              {point && <p className="quiz-sentence" lang="ja">{question?.prompt ?? point.prompt}</p>}
              {question && <><p>正确答案 <strong lang="ja">{question.answer}</strong></p><p>{question.explanation}</p></>}
            </details> : <p className="muted small">原条目暂不可用。</p>}
            <div className="bookmark-entry-actions">
              <button className="link" aria-haspopup="dialog" onClick={open('edit')}>编辑备注</button>
              <button className="link" aria-haspopup="dialog" onClick={open('remove')}>移除书签</button>
            </div>
          </li>
        })}
      </ul>}
    {editor && <BookmarkDialog action={editor.action} target={editor.bookmark} label={editor.label} note={editor.bookmark.note}
      onClose={() => setEditor(undefined)} />}
  </section>
}
