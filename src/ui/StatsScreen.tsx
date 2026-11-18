import { useState } from 'react'
import type { Word } from '../types'
import { getAllAttempts, getBaselineMap } from '../db/queries'
import { listReviewItems } from '../db/review'
import { listSessions } from '../db/sessions'
import { getAllWords, getWords } from '../db/wordlists'
import { attemptsCsv, resultsCsv } from '../lib/exports'
import { breakdown, summarizeBaseline, summarizeRetention } from '../lib/stats'
import { useApp } from './app-context'
import { DimTable } from './StatsTables'
import { useLoad } from './useLoad'
import { FRAME_LABEL, SCOPE_LABEL, downloadText, fileStamp, fmtInterval, fmtMs, fmtPct, fmtTime } from './format'
import { STAGE_LABELS } from '../lib/schedule'

export function StatsScreen({ initialId }: { initialId?: string }) {
  const { db, version } = useApp()
  const [picked, setPicked] = useState(initialId ?? '')
  const { data, error } = useLoad(async () => {
    const sessions = await listSessions(db, 'vocabulary')
    const s = sessions.find((x) => x.id === picked) ?? sessions[0]
    const [base, attempts, items] = await Promise.all([getBaselineMap(db), getAllAttempts(db, 'vocabulary'), listReviewItems(db)])
    const words = s ? await getWords(db, s.order) : []
    return { sessions, s, base, attempts, items, words }
  }, [db, version, picked])

  if (!data) return <p className="muted pad">{error || '加载中…'}</p>
  const { sessions, s, base, attempts, items, words } = data
  if (!s) return <p className="pad">还没有基线测试数据。先在「单词」页开始一次抽样或普查。</p>

  const sum = summarizeBaseline(s, base)
  const retention = summarizeRetention(attempts)
  const frameWords = words.filter((w) => base.has(w.id))
  const scopeLabel = SCOPE_LABEL[s.scope]
  const exportResults = () => {
    const wordMap = new Map<string, Word>(words.map((w) => [w.id, w]))
    const rows = s.order.flatMap((id) => (wordMap.has(id) ? [{ word: wordMap.get(id)!, baseline: base.get(id), review: items.find((i) => i.wordId === id) }] : []))
    downloadText(`baseline-${scopeLabel}-${fileStamp()}.csv`, resultsCsv(rows, scopeLabel))
  }

  return (
    <div className="panel">
      <label className="form">
        基线会话
        <select value={s.id} onChange={(e) => setPicked(e.target.value)}>
          {sessions.map((x) => (
            <option key={x.id} value={x.id}>{x.wordlistName} · {SCOPE_LABEL[x.scope]} · {x.mode === 'sample' ? `抽样 ${x.sampleSize}` : '普查'} · {fmtTime(x.createdAt)}</option>
          ))}
        </select>
      </label>

      <section className="block">
        <h2>首次基线{!s.scope.endsWith('-only') && <> <span className={`badge scope-${s.scope}`}>{scopeLabel}</span></>}</h2>
        <p className="muted small">
          样本框：{s.wordlistName}（{s.frameSize} 词，{FRAME_LABEL[s.frameType]}，指纹 {s.frameHash}）· {s.mode === 'sample' ? `随机抽样 n=${s.sampleSize}，种子 ${s.seed}` : `全量普查，随机顺序种子 ${s.seed}`} · 抽取于 {fmtTime(s.drawnAt)}
          · 测试条件：{s.hint === 'example' ? '词形 + 例句提示（有例句的词；掌握率可能比只看词形偏高）' : '只显示词形'}
        </p>
        <div className="stat-grid">
          <div><span>完成率</span><strong>{fmtPct(sum.completion)}</strong><small>{sum.rated} / {sum.sampleSize}</small></div>
          <div className="A"><span>A 掌握</span><strong>{sum.counts.A}</strong><small>{fmtPct(sum.rates.A)}</small></div>
          <div className="B"><span>B 模糊</span><strong>{sum.counts.B}</strong><small>{fmtPct(sum.rates.B)}</small></div>
          <div className="C"><span>C 不认识</span><strong>{sum.counts.C}</strong><small>{fmtPct(sum.rates.C)}</small></div>
        </div>
        <p>
          <strong>独立识词覆盖率（A 占比）：{sum.rated ? fmtPct(sum.rates.A) : '—'}</strong>
          {sum.ciA && <> · 95% 置信区间 {fmtInterval(sum.ciA)}</>}
          {sum.ciC && <span className="muted"> · C 占比区间 {fmtInterval(sum.ciC)}</span>}
        </p>
        <p className={sum.inference === 'none' ? 'notice' : 'muted small'}>{sum.inferenceNote}</p>
        <p className="muted small">
          耗时：本次有效用时 {fmtMs(sum.timing.sessionActiveMs)} · 本会话作答 {sum.timing.answered} 词，平均 {fmtMs(sum.timing.meanMs)}，中位 {fmtMs(sum.timing.medianMs)}
        </p>
      </section>

      <DimTable title="按词性" rows={breakdown('pos', frameWords, base)} />
      <DimTable title="假名词 / 汉字词" rows={breakdown('script', frameWords, base)} />
      <DimTable title="复合动词（启发式，只含动词）" rows={breakdown('compound', frameWords, base)} note="复合动词按词形规则判断，没有形态分析器，只用假名书写的词可能漏判。" />
      <DimTable title="按 JLPT 级别" rows={breakdown('level', frameWords, base)} note="累计词表请分级别看，不要把 N5/N4 的结果当作 N3 的结果。" />

      <section className="block">
        <h2>复习后的记忆保持率</h2>
        <p className="muted small">只统计复习作答（每次 A 算通过），和上面首次基线的「独立识词覆盖率」是两个指标，不合并。</p>
        {retention.total === 0 ? <p className="muted">还没有复习记录。</p> : (
          <>
            <p><strong>通过率 {fmtPct(retention.rate ?? 0)}</strong> · {retention.passed} / {retention.total} 次 · 涉及 {retention.wordsReviewed} 词</p>
            <ul>{retention.byStage.map((r) => <li key={r.stage}>{STAGE_LABELS[r.stage]}：{r.passed} / {r.n}（{fmtPct(r.rate ?? 0)}）</li>)}</ul>
          </>
        )}
      </section>

      <div className="row">
        <button onClick={exportResults}>导出本会话结果 CSV</button>
        <button onClick={async () => downloadText(`attempts-${fileStamp()}.csv`, attemptsCsv(attempts, new Map((await getAllWords(db)).map((w) => [w.id, w]))))}>导出全部作答日志 CSV</button>
      </div>
    </div>
  )
}
