import { useState } from 'react'
import { getAllAttempts, getBaselineMap } from '../db/queries'
import { listSessions } from '../db/sessions'
import { toCsv } from '../lib/csv'
import { GRAMMAR_LEVELS, grammarById, grammarPoints, grammarSource, type GrammarPoint } from '../lib/grammar'
import { grammarQuestions, QUIZ_BLANK, quizAnswers } from '../lib/grammarQuiz'
import { emptyCounts, sumCounts, summarizeBaseline } from '../lib/stats'
import { GRADE_LABEL, type Attempt, type Baseline, type Session } from '../types'
import { useApp } from './app-context'
import { downloadText, fileStamp, fmtInterval, fmtMs, fmtPct, fmtTime } from './format'
import { useLoad } from './useLoad'

function levelSummary(points: GrammarPoint[], base: ReadonlyMap<string, Baseline>) {
  return GRAMMAR_LEVELS.map((level) => {
    const entries = points.filter((point) => point.level === level)
    const counts = emptyCounts()
    for (const point of entries) {
      const grade = base.get(point.id)?.grade
      if (grade) counts[grade]++
    }
    return { level, total: entries.length, rated: sumCounts(counts), counts }
  }).filter((row) => row.total > 0)
}

export function QuizResult({ session, answers }: { session: Session; answers: Attempt[] }) {
  const correct = answers.filter((a) => a.grade === 'A').length
  return (
    <section className="block">
      <h2>答题明细</h2>
      <p>已答 {answers.length} / {session.sampleSize} 题 · 答对 {correct} · 答错 {answers.length - correct}
        {answers.length > 0 && ` · 正确率 ${fmtPct(correct / answers.length)}`}
      </p>
      {answers.length > 0 && (
        <ul className="cards">
          {answers.map((a) => {
            const point = grammarById.get(a.wordId)
            const item = grammarQuestions.get(a.wordId)
            return (
              <li key={a.id}>
                <details>
                  <summary>
                    <span className={`chip chip-${a.grade}`}>{a.grade === 'A' ? '答对' : '答错'}</span>{' '}
                    <span lang="ja">{point?.pattern ?? a.wordId}</span>
                  </summary>
                  <p>你选了 <span lang="ja">{a.choice}</span> · 正确答案 <span lang="ja">{item?.answer}</span></p>
                  {item && <>
                    <p className="quiz-sentence" lang="ja">{item.prompt.replace(QUIZ_BLANK, item.answer)}</p>
                    <p>{item.explanation}</p>
                  </>}
                </details>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export function GrammarReport({ initialId, onBack, legacyOnly = false }: { initialId?: string; onBack?: () => void; legacyOnly?: boolean }) {
  const { db, version } = useApp()
  const { data, error } = useLoad(async () => {
    const [sessions, base, attempts] = await Promise.all([
      listSessions(db, 'grammar'), getBaselineMap(db, 'grammar'), getAllAttempts(db, 'grammar'),
    ])
    return { sessions: legacyOnly ? sessions.filter((s) => !s.grammarQuiz) : sessions, base, answers: quizAnswers(attempts).sort((a, b) => a.seq - b.seq) }
  }, [db, version, legacyOnly])
  const [sessionId, setSessionId] = useState(initialId ?? '')
  const [level, setLevel] = useState('')
  const [filter, setFilter] = useState('all')

  if (!data) return <p className="muted pad">{error || '加载中…'}</p>
  const { sessions, base } = data
  const session = sessions.find((s) => s.id === sessionId)
  const controls = <>
    {onBack && <div className="row"><button onClick={onBack}>← 语法速筛</button></div>}
    <div className="block">
      <label className="form">
        报告范围
        <select value={session?.id ?? ''} onChange={(e) => { setSessionId(e.target.value); setLevel('') }}>
          <option value="">语法库 · 累计翻卡自评</option>
          {sessions.map((s) => <option key={s.id} value={s.id}>
            {s.wordlistName} · {s.grammarQuiz ? '单选' : '自评'} {s.sampleSize} · {fmtTime(s.createdAt)}
          </option>)}
        </select>
      </label>
    </div>
  </>
  if (session?.grammarQuiz) return (
    <div className="panel">
      {controls}
      <QuizResult session={session} answers={data.answers.filter((a) => a.sessionId === session.id)} />
    </div>
  )

  const points = session ? session.order.flatMap((id) => grammarById.get(id) ?? []) : grammarPoints
  const summary = session ? summarizeBaseline(session, base) : undefined
  const rows = levelSummary(points, base)
  const shown = points.filter((point) => {
    if (level && point.level !== level) return false
    const grade = base.get(point.id)?.grade
    if (filter === 'all') return true
    if (filter === 'gaps') return grade === 'B' || grade === 'C'
    return filter === (grade ?? 'unrated')
  })
  const exportCsv = () => {
    const detail = shown.map((point) => {
      const first = base.get(point.id)
      return [point.id, point.level, point.pattern, point.prompt, first?.grade, first?.ratedAt, first?.durationMs, point.questionCount]
    })
    const header = ['id', 'level', 'pattern', 'prompt', 'first_grade', 'first_rated_at', 'first_duration_ms', 'source_questions']
    downloadText(`jlpt-grammar-${fileStamp()}.csv`, '\uFEFF' + toCsv([header, ...detail], { guardFormulas: true }))
  }

  return (
    <div className="panel">
      {controls}
      <section className="block">
        <h2>语法掌握报告</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>级别</th><th>已评 / 范围</th><th>A 掌握</th><th>B 模糊</th><th>C 不认识</th><th>A 占已评</th></tr></thead>
            <tbody>{rows.map(({ level: rowLevel, total, rated, counts }) => {
              const mastered = rated ? counts.A / rated : null
              return <tr key={rowLevel}>
                <th scope="row">{rowLevel}</th><td>{rated} / {total}</td><td>{counts.A}</td><td>{counts.B}</td><td>{counts.C}</td>
                <td>{mastered === null ? '—' : <>
                  <span className="bar" aria-hidden="true"><i style={{ width: `${mastered * 100}%` }} /></span> {fmtPct(mastered)}
                </>}</td>
              </tr>
            })}</tbody>
          </table>
        </div>
        {summary && <>
          {summary.ciA && <p><strong>A 占比的 95% 置信区间 {fmtInterval(summary.ciA)}</strong></p>}
          <p className="muted small">{summary.inferenceNote}</p>
          <p className="muted small">本次有效用时 {fmtMs(summary.timing.sessionActiveMs)} · 作答 {summary.timing.answered} 个语法点 · 平均 {fmtMs(summary.timing.meanMs)} · 中位 {fmtMs(summary.timing.medianMs)}</p>
        </>}
        <p className="muted small">范围为{grammarSource.label}内收录的语法点（{grammarSource.capturedAt}）。掌握率采用自评结果。</p>
      </section>

      {!legacyOnly && <section className="block">
        <h2>语法库明细</h2>
        <div className="row">
          <label>级别<select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">全部级别</option>
            {rows.map((row) => <option key={row.level}>{row.level}</option>)}
          </select></label>
          <label>掌握状态<select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">全部</option>
            <option value="gaps">B / C 待巩固</option>
            <option value="A">A 掌握</option>
            <option value="B">B 模糊</option>
            <option value="C">C 不认识</option>
            <option value="unrated">未评估</option>
          </select></label>
          <button onClick={exportCsv} disabled={!shown.length}>导出当前明细 CSV</button>
        </div>
        <p className="muted small">共 {shown.length} 个语法点</p>
        {shown.length > 0 && <div className="table-wrap">
          <table className="grammar-detail-table">
            <colgroup>
              <col className="grammar-detail-level" />
              <col className="grammar-detail-pattern" />
              <col />
              <col className="grammar-detail-grade" />
            </colgroup>
            <thead><tr><th>级别</th><th>语法点</th><th>代表题干</th><th>首评</th></tr></thead>
            <tbody>{shown.map((point) => {
              const grade = base.get(point.id)?.grade
              return <tr key={point.id}>
                <td>{point.level}</td><td lang="ja">{point.pattern}</td><td lang="ja">{point.prompt}</td>
                <td>{grade ? <span className={`chip chip-${grade}`}>{grade} {GRADE_LABEL[grade]}</span> : '未评估'}</td>
              </tr>
            })}</tbody>
          </table>
        </div>}
      </section>}
    </div>
  )
}
