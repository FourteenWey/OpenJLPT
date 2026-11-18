import { useState } from 'react'
import { getAllAttempts } from '../db/queries'
import { listReviewItems } from '../db/review'
import { grammarById } from '../lib/grammar'
import { grammarQuestions, QUIZ_BLANK } from '../lib/grammarQuiz'
import { grammarAnkiCsv, grammarLearning, grammarResultsCsv } from '../lib/grammarLearning'
import { STAGE_LABELS } from '../lib/schedule'
import { useApp } from './app-context'
import { useLoad } from './useLoad'
import { GrammarLevelSelect } from './GrammarFilters'
import { downloadText, fileStamp, fmtTime } from './format'

export function GrammarWrongQuestions({ onReview }: { onReview: () => void }) {
  const { db, version } = useApp()
  const [level, setLevel] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('active')
  const { data, error } = useLoad(async () => ({ items: await listReviewItems(db, 'grammar'), attempts: await getAllAttempts(db, 'grammar') }), [db, version])
  if (!data) return <p className="muted pad">{error || '加载中…'}</p>
  const { history, latest, errors } = grammarLearning(data.attempts)
  const shown = data.items.filter((i) => {
    const p = grammarById.get(i.wordId)
    return (status === 'all' || i.status === status) && (!level || p?.level === level) && (p?.pattern ?? i.wordId).includes(search.trim())
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.wordId.localeCompare(b.wordId))
  const points = shown.flatMap((i) => grammarById.get(i.wordId) ?? [])
  const activePoints = shown.filter((i) => i.status === 'active').flatMap((i) => grammarById.get(i.wordId) ?? [])
  return <div className="panel">
    <h2>语法错题</h2>
    <div className="row">
      <GrammarLevelSelect value={level} onChange={setLevel} />
      <label>搜索语法点<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      <label>状态<select value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="active">待复习</option><option value="graduated">已毕业</option><option value="all">全部</option>
      </select></label>
      <button className="primary" onClick={onReview}>进入今日语法复习</button>
      <button disabled={!points.length} onClick={() => downloadText(`grammar-wrong-${fileStamp()}.csv`, '\uFEFF' + grammarResultsCsv(points, data.attempts, data.items))}>导出当前错题 CSV</button>
      <button disabled={!activePoints.length} onClick={() => downloadText(`anki-grammar-${fileStamp()}.csv`, grammarAnkiCsv(activePoints))}>导出待复习语法 Anki CSV</button>
    </div>
    <p className="muted small">共 {shown.length} 题。普通练习答对不会移出错题；完成间隔复习后毕业，再次答错重新从当天开始。</p>
    {!shown.length ? <p className="muted">没有符合条件的语法错题。</p> : <ul className="cards grammar-wrong-list">
      {shown.map((i) => {
        const p = grammarById.get(i.wordId)
        const q = grammarQuestions.get(i.wordId)
        const last = latest.get(i.wordId)
        return <li key={i.wordId}>
          <div className="grammar-wrong-heading"><strong lang="ja">{p?.pattern ?? i.wordId}</strong><span className="badge">{p?.level ?? '题目已移除'}</span>
            <span className={i.status === 'graduated' ? 'chip chip-A' : 'chip chip-B'}>{i.status === 'graduated' ? '已毕业' : STAGE_LABELS[i.stage]}</span></div>
          <div className="muted small">累计答错 {errors.get(i.wordId) ?? 0} 次 · 最近结果：{last?.grade === 'A' ? '答对' : '答错'} · 下次复习：{i.status === 'graduated' ? '—' : i.dueDate}</div>
          <details><summary>查看题目与作答历史</summary>
            {q && <><p className="quiz-sentence" lang="ja">{q.prompt.replace(QUIZ_BLANK, q.answer)}</p><p>{q.explanation}</p></>}
            <ol className="small">{history.filter((a) => a.wordId === i.wordId).map((a) => <li key={a.id}>
              {fmtTime(a.answeredAt)} · {a.kind === 'review' ? '复习' : '快筛'} · {a.grade === 'A' ? '答对' : '答错'} · 选择 <span lang="ja">{a.choice}</span>
            </li>)}</ol>
          </details>
        </li>
      })}
    </ul>}
  </div>
}
