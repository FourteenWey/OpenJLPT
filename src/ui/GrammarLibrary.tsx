import { useState } from 'react'
import { GRAMMAR_LEVELS, grammarPoints, grammarSource } from '../lib/grammar'
import { grammarQuestions, QUIZ_BLANK } from '../lib/grammarQuiz'
import { grammarAttemptsCsv, grammarQuestionsCsv, grammarResultsCsv } from '../lib/grammarLearning'
import { getAllAttempts } from '../db/queries'
import { listReviewItems } from '../db/review'
import { useApp } from './app-context'
import { useLoad } from './useLoad'
import { GrammarLevelSelect } from './GrammarFilters'
import { downloadText, fileStamp } from './format'

export function GrammarLibrary() {
  const { db, version } = useApp()
  const { data, error } = useLoad(async () => ({ attempts: await getAllAttempts(db, 'grammar'), items: await listReviewItems(db, 'grammar') }), [db, version])
  const [level, setLevel] = useState('')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(30)
  const shown = grammarPoints.filter((p) => (!level || p.level === level) && p.pattern.toLowerCase().includes(search.trim().toLowerCase()))
  return <section className="block">
    <h2>内置语法题库</h2>
    <p className="muted small">共 {grammarPoints.length} 个语法点，每点一道四选一题。来源：{grammarSource.label}（{grammarSource.capturedAt}）；题干、选项与中文解析由本项目编写。</p>
    <p className="muted small">{GRAMMAR_LEVELS.map((v) => `${v} ${grammarPoints.filter((p) => p.level === v).length} 题`).join(' · ')}</p>
    <div className="row">
      <GrammarLevelSelect value={level} onChange={(v) => { setLevel(v); setLimit(30) }} />
      <label>搜索语法点<input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(30) }} /></label>
      <button disabled={!shown.length} onClick={() => downloadText(`grammar-library-${fileStamp()}.csv`, '\uFEFF' + grammarQuestionsCsv(shown))}>导出当前题库 CSV</button>
      <button disabled={!data || !shown.length} onClick={() => data && downloadText(`grammar-results-${fileStamp()}.csv`, '\uFEFF' + grammarResultsCsv(shown, data.attempts, data.items))}>导出学习结果 CSV</button>
      <button disabled={!data} onClick={() => data && downloadText(`grammar-attempts-${fileStamp()}.csv`, '\uFEFF' + grammarAttemptsCsv(data.attempts.filter((a) => shown.some((p) => p.id === a.wordId))))}>导出语法日志 CSV</button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    <p className="muted small">符合条件 {shown.length} 题</p>
    {!shown.length ? <p className="muted">没有符合条件的语法题。</p> : <div className="table-wrap">
      <table className="grammar-library-table">
        <colgroup><col className="grammar-detail-level" /><col className="grammar-detail-pattern" /><col /></colgroup>
        <thead><tr><th>级别</th><th>语法点</th><th>题目与解析</th></tr></thead>
        <tbody>{shown.slice(0, limit).map((p) => {
          const q = grammarQuestions.get(p.id)
          return <tr key={p.id}><td>{p.level}</td><td lang="ja">{p.pattern}</td><td>
            <p className="quiz-sentence" lang="ja">{q?.prompt}</p>
            {q && <details><summary>查看选项、答案与解析</summary>
              <ol lang="ja">{q.options.map((option) => <li key={option}>{option}</li>)}</ol>
              <p className="quiz-sentence" lang="ja">{q.prompt.replace(QUIZ_BLANK, q.answer)}</p><p>{q.explanation}</p>
            </details>}
          </td></tr>
        })}</tbody>
      </table>
    </div>}
    {shown.length > limit && <button onClick={() => setLimit((v) => v + 30)}>再显示 30 题</button>}
  </section>
}
