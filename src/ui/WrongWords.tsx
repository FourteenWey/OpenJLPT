import { useState } from 'react'
import type { Grade, ReviewItem, Word } from '../types'
import { GRADE_KEY, GRADE_LABEL } from '../types'
import { selectWordlist } from '../db/builtin'
import { getBaselineMap } from '../db/queries'
import { listReviewItems } from '../db/review'
import { getWords, listWordlists } from '../db/wordlists'
import { ankiCsv, meaningText } from '../lib/exports'
import { STAGE_LABELS } from '../lib/schedule'
import { useApp } from './app-context'
import { useLoad } from './useLoad'
import { SCOPE_LABEL, downloadText, fileStamp } from './format'

type Filter = 'active' | 'graduated' | 'all'
const chip = (g?: Grade) => (g ? <span className={`chip chip-${g}`}>{GRADE_KEY[g]} {GRADE_LABEL[g]}</span> : <span className="muted">—</span>)

export function WrongWords() {
  const { db, version } = useApp()
  const [listId, setListId] = useState('')
  const [filter, setFilter] = useState<Filter>('active')
  const { data, error } = useLoad(async () => {
    const lists = await listWordlists(db)
    const list = selectWordlist(lists, listId)
    const inList = new Set(list?.wordIds)
    const items = (await listReviewItems(db)).filter((i) => inList.has(i.wordId))
    const words = new Map((await getWords(db, items.map((i) => i.wordId))).map((w) => [w.id, w]))
    return { lists, list, items, words, base: await getBaselineMap(db) }
  }, [db, version, listId])

  if (!data) return <p className="muted pad">{error || '加载中…'}</p>
  const { lists, list, items, words, base } = data
  if (!list) return <p className="pad">还没有词表。</p>

  const shown = items
    .filter((i) => filter === 'all' || i.status === filter)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.wordId.localeCompare(b.wordId))
  const exportAnki = () => {
    const rows = items
      .filter((i) => i.status === 'active' && words.has(i.wordId))
      .map((i: ReviewItem) => ({ word: words.get(i.wordId) as Word, first: base.get(i.wordId)?.grade ?? i.lastGrade, latest: i.lastGrade }))
    downloadText(`anki-wrong-words-${SCOPE_LABEL[list.scope]}-${fileStamp()}.csv`, ankiCsv(rows, list.scope, `JLPT 错词 ${SCOPE_LABEL[list.scope]}`))
  }

  return (
    <div className="panel">
      <h2>错词</h2>
      <div className="row">
        <label>词表
          <select value={list.id} onChange={(e) => setListId(e.target.value)}>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name} · {SCOPE_LABEL[l.scope]}</option>)}
          </select>
        </label>
        <label>状态
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="active">待复习</option>
            <option value="graduated">已毕业</option>
            <option value="all">全部</option>
          </select>
        </label>
        <button onClick={exportAnki} disabled={!items.some((i) => i.status === 'active')}>导出待复习错词为 Anki CSV</button>
      </div>
      <p className="muted small">只有首评为 B/C 的词进入队列。「首评」永久保留，「最近评级」是最近一次作答（首评或复习）。</p>
      {shown.length === 0 ? <p className="empty-note">没有符合条件的词。</p> : <ul className="cards wrong-word-list">
        {shown.map((i) => {
          const word = words.get(i.wordId)
          return <li key={i.wordId}>
            <details>
              <summary><strong lang="ja">{word?.word ?? i.wordId}</strong> <span className="chip chip-B">{i.status === 'graduated' ? '已毕业' : STAGE_LABELS[i.stage]}</span></summary>
              {word && <p><span lang="ja">{word.reading}</span> · {meaningText(word)}</p>}
              <dl className="word-review-details">
                <div><dt>首评</dt><dd>{chip(base.get(i.wordId)?.grade)}</dd></div>
                <div><dt>最近评级</dt><dd>{chip(i.lastGrade)}</dd></div>
                <div><dt>下次复习</dt><dd>{i.status === 'graduated' ? '—' : i.dueDate}</dd></div>
                <div><dt>累计答错</dt><dd>{i.lapses} 次</dd></div>
              </dl>
            </details>
          </li>
        })}
      </ul>}
    </div>
  )
}
