import { useState } from 'react'
import { getAllAttempts, getBaselineMap } from '../db/queries'
import { listSessions } from '../db/sessions'
import { listReviewItems } from '../db/review'
import { GRAMMAR_LEVELS, grammarById, grammarPoints } from '../lib/grammar'
import { quizAnswers } from '../lib/grammarQuiz'
import { grammarAttemptsCsv, grammarResultsCsv, summarizeGrammar } from '../lib/grammarLearning'
import { summarizeRetention } from '../lib/stats'
import { localDate, STAGE_LABELS } from '../lib/schedule'
import { useApp } from './app-context'
import { useLoad } from './useLoad'
import { GrammarLevelSelect } from './GrammarFilters'
import { GrammarReport, QuizResult } from './GrammarReport'
import { downloadText, fileStamp, fmtPct, fmtTime } from './format'

export function GrammarStatsScreen({ initialId }: { initialId?: string }) {
  const { db, version } = useApp()
  const [level, setLevel] = useState('')
  const [picked, setPicked] = useState(initialId ?? '')
  const { data, error } = useLoad(async () => ({
    attempts: await getAllAttempts(db, 'grammar'), sessions: await listSessions(db, 'grammar'),
    items: await listReviewItems(db, 'grammar'), base: await getBaselineMap(db, 'grammar'),
  }), [db, version])
  if (!data) return <p className="muted pad">{error || '加载中…'}</p>
  const points = grammarPoints.filter((p) => !level || p.level === level)
  const ids = new Set(points.map((p) => p.id))
  const attempts = data.attempts.filter((a) => ids.has(a.wordId))
  const items = data.items.filter((i) => ids.has(i.wordId))
  const summary = summarizeGrammar(attempts, points)
  const retention = summarizeRetention(attempts)
  const quizzes = data.sessions.filter((s) => s.grammarQuiz)
  const session = quizzes.find((s) => s.id === picked)
  const answers = quizAnswers(data.attempts).sort((a, b) => a.seq - b.seq)
  const pct = (value: number | null) => value === null ? '—' : fmtPct(value)
  const selectedAttempts = session ? data.attempts.filter((a) => a.sessionId === session.id) : attempts
  const selectedPoints = session ? session.order.flatMap((id) => grammarById.get(id) ?? []) : points
  return <div className="panel">
    <h2>语法答题统计</h2>
    <div className="row"><GrammarLevelSelect value={level} onChange={setLevel} /></div>
    <section className="block">
      <h3>累计练习</h3>
      <div className="stat-grid">
        <div><span>练习覆盖率</span><strong>{fmtPct(summary.coverage)}</strong><small>{summary.covered} / {summary.total} 个语法点</small></div>
        <div><span>快筛正确率</span><strong>{pct(summary.accuracy)}</strong><small>{summary.correct} / {summary.answered} 次</small></div>
        <div><span>今日到期</span><strong>{items.filter((i) => i.status === 'active' && i.dueDate <= localDate()).length}</strong><small>待复习 {items.filter((i) => i.status === 'active').length} 题</small></div>
        <div><span>已毕业</span><strong>{items.filter((i) => i.status === 'graduated').length}</strong><small>完成全部间隔复习</small></div>
      </div>
      <p className="muted small">覆盖率按语法点去重；快筛正确率按作答次数计算，重做也计入。已撤销记录不计入；这些结果描述本题库的练习表现。</p>
      <div className="table-wrap"><table>
        <thead><tr><th>级别</th><th>已练 / 题库</th><th>覆盖率</th><th>首答正确率</th><th>练习正确率</th><th>待复习</th></tr></thead>
        <tbody>{GRAMMAR_LEVELS.filter((v) => !level || v === level).map((v) => {
          const row = summarizeGrammar(data.attempts, grammarPoints.filter((p) => p.level === v))
          return <tr key={v}><th scope="row">{v}</th><td>{row.covered} / {row.total}</td><td>{fmtPct(row.coverage)}</td>
            <td>{pct(row.firstAccuracy)}</td><td>{pct(row.accuracy)}</td><td>{data.items.filter((i) => i.status === 'active' && grammarById.get(i.wordId)?.level === v).length}</td></tr>
        })}</tbody>
      </table></div>
    </section>
    <section className="block">
      <h3>语法复习表现</h3>
      <p className="muted small">仅统计间隔复习作答，与快筛成绩分开。</p>
      {!retention.total ? <p className="muted">还没有语法复习记录。</p> : <>
        <p>复习正确率 <strong>{pct(retention.rate)}</strong> · {retention.passed} / {retention.total} 次 · 涉及 {retention.wordsReviewed} 个语法点</p>
        <ul>{retention.byStage.map((r) => <li key={r.stage}>{STAGE_LABELS[r.stage]}：{r.passed} / {r.n}（{pct(r.rate)}）</li>)}</ul>
      </>}
    </section>
    <section className="block">
      <h3>快筛会话成绩</h3>
      <label className="form">语法会话<select value={session?.id ?? ''} onChange={(e) => setPicked(e.target.value)}>
        <option value="">选择会话查看明细</option>
        {quizzes.map((s) => <option key={s.id} value={s.id}>{s.wordlistName} · {s.sampleSize} 题 · {fmtTime(s.createdAt)}</option>)}
      </select></label>
      {!quizzes.length && <p className="muted">还没有语法快筛记录。先到「语法」页开始练习。</p>}
      {session && <QuizResult session={session} answers={answers.filter((a) => a.sessionId === session.id)} />}
    </section>
    <div className="row">
      <button onClick={() => downloadText(`grammar-results-${fileStamp()}.csv`, '\uFEFF' + grammarResultsCsv(selectedPoints, selectedAttempts, data.items))}>{session ? '导出本会话结果 CSV' : '导出当前语法结果 CSV'}</button>
      <button onClick={() => downloadText(`grammar-attempts-${fileStamp()}.csv`, '\uFEFF' + grammarAttemptsCsv(attempts))}>导出语法作答日志 CSV</button>
    </div>
    {(data.base.size > 0 || data.sessions.some((s) => !s.grammarQuiz)) && <details open={data.sessions.some((s) => s.id === initialId && !s.grammarQuiz)}>
      <summary>历史翻卡自评（与单选成绩分开）</summary><GrammarReport initialId={initialId} legacyOnly />
    </details>}
  </div>
}
