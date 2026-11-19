import { useState } from 'react'
import { selectWordlist } from '../db/builtin'
import { createSession, deleteUnansweredGrammarSession, getDeletedGrammarSession, listSessions, restoreDeletedGrammarSession } from '../db/sessions'
import { listWordlists } from '../db/wordlists'
import { getAllAttempts, getBaselineMap } from '../db/queries'
import { grammarQuizFrames, quizAnswers } from '../lib/grammarQuiz'
import { parseSeed } from '../lib/rng'
import type { StudySubject } from '../types'
import { useApp } from './app-context'
import { useLoad } from './useLoad'
import { FRAME_LABEL, SCOPE_LABEL, fmtTime } from './format'
import { StudyIcon } from './StudyIcon'
import { StudyLevelPicker } from './StudyLevelPicker'

interface Props {
  onBack: () => void
  onOpen: (sessionId: string) => void
  onStats: (sessionId: string) => void
  subject?: StudySubject
  onGrammarReport?: () => void
  onGrammarLibrary?: () => void
}

const STATUS = { active: '进行中', paused: '已暂停', completed: '已完成' } as const

export function StartPanel({ onBack, onOpen, onStats, subject = 'vocabulary', onGrammarReport, onGrammarLibrary }: Props) {
  const { db, version, bump } = useApp()
  const grammar = subject === 'grammar'
  const { data, error } = useLoad(
    async () => ({
      lists: grammar ? grammarQuizFrames : await listWordlists(db),
      sessions: await listSessions(db, subject),
      base: await getBaselineMap(db, subject),
      attempts: grammar ? await getAllAttempts(db, 'grammar') : [],
      deleted: grammar ? await getDeletedGrammarSession(db) : undefined,
    }),
    [db, version, subject],
  )
  const [listId, setListId] = useState('')
  const [mode, setMode] = useState<'sample' | 'census'>('sample')
  const [size, setSize] = useState(grammar ? '20' : '200')
  const [seedText, setSeedText] = useState('')
  const [hint, setHint] = useState(true)
  const [msg, setMsg] = useState('')
  const [starting, setStarting] = useState(false)
  const [updatingHistory, setUpdatingHistory] = useState(false)
  const [historyError, setHistoryError] = useState('')

  if (!data) return <p className="muted pad" role={error ? 'alert' : 'status'}>{error || '加载中…'}</p>
  const list = selectWordlist(data.lists, listId)
  if (!list) return <p className="empty-note">还没有词表。可在「更多 → 词表与题库」载入或导入词表。</p>
  const unit = grammar ? '题' : '词'
  const answered = new Map<string, number>()
  for (const answer of quizAnswers(data.attempts)) answered.set(answer.sessionId, (answered.get(answer.sessionId) ?? 0) + 1)
  const attemptedSessions = new Set(data.attempts.map((attempt) => attempt.sessionId))
  const deleted = data.deleted

  const start = async () => {
    if (starting) return
    setStarting(true)
    setMsg('')
    try {
      const n = Number(size)
      if (mode === 'sample' && !Number.isInteger(n)) throw new Error('样本量需要是整数')
      const s = await createSession(db, { wordlistId: list.id, subject, grammarQuiz: grammar, mode, sampleSize: n, seed: parseSeed(seedText) ?? undefined, hint: hint ? 'example' : 'none' })
      bump()
      onOpen(s.id)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  const updateHistory = async (update: () => Promise<void>) => {
    setUpdatingHistory(true)
    setHistoryError('')
    try {
      await update()
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e))
    } finally {
      bump()
      setUpdatingHistory(false)
    }
  }

  return (
    <div className="setup-page">
      <header className="setup-heading">
        <button className="link back-link" onClick={onBack}><StudyIcon name="back" /> 练习首页</button>
        <h1>{grammar ? '语法速筛' : '单词快筛'}</h1>
        <p>{grammar ? '读例句或对话，选出最合适的表达，答完就能看中文解析。' : '先回想读音和词义，翻开答案后判断记得有多牢。'}</p>
      </header>
      <div className="setup-layout">
        <form className="form setup-form block" noValidate onSubmit={(e) => { e.preventDefault(); void start() }}>
          <StudyLevelPicker lists={data.lists} selected={list} grammar={grammar} onChange={setListId} />
          <fieldset className="choice-field">
            <legend>练习方式</legend>
            <div className="mode-choices">
              <label className="choice-pill"><input type="radio" name="study-mode" checked={mode === 'sample'} onChange={() => setMode('sample')} /><span>随机抽取</span></label>
              <label className="choice-pill"><input type="radio" name="study-mode" checked={mode === 'census'} onChange={() => setMode('census')} /><span>全部练习</span></label>
            </div>
          </fieldset>
          {mode === 'sample' && <label className="quantity-field">{grammar ? '题量' : '词数'}<input type="number" inputMode="numeric" min={1} max={list.wordIds.length} value={size} onChange={(e) => setSize(e.target.value)} /></label>}
          {!grammar && <label className="inline hint-choice">
            <input type="checkbox" checked={hint} onChange={(e) => setHint(e.target.checked)} /> 词形下方显示例句
          </label>}
          <details className="disclosure">
            <summary>{mode === 'sample' ? '抽取设置与说明' : '练习说明'}</summary>
            {mode === 'sample' && <label>随机种子（可选）<input value={seedText} placeholder="留空自动生成" onChange={(e) => setSeedText(e.target.value)} /></label>}
            <p className="muted small">
              {grammar ? '根据例句或对话选 A、B、C、D，提交后查看中文解析。每次会话独立计分，可以重做。' : <>
                {list.scope.endsWith('-only') && `范围：${SCOPE_LABEL[list.scope]} 级别词汇。`}
                {list.scope === 'N5-N3-cumulative' && '范围：N5、N4、N3 累计词汇；统计页会按级别分开列出。'}
                {list.scope === 'custom' && '范围：自定义词表。'}
                {list.frameType === 'curated' ? ' 该词表为人工挑选，结果不推断总体。' : mode === 'sample' ? ' 无放回随机抽取；答完后给出 95% 置信区间。' : ''}
                {' '}已有首评的词会沿用原评级，不再询问。
              </>}
            </p>
            {!grammar && <p className="muted small">例句来自 Tatoeba。遇到多音词以答案面的读音为准。例句提示会记录在会话里，建议用相同设置比较掌握率。</p>}
          </details>
          {!grammar && <p className="muted small form-note">已评过的单词会沿用首次评级。</p>}
          <button className="primary setup-start" type="submit" disabled={starting || !list.wordIds.length}>{grammar ? '开始语法速筛' : '开始单词快筛'} <StudyIcon name="arrow" /></button>
          {msg && <p className="error" role="alert">{msg}</p>}
        </form>
        <section className="setup-history" aria-labelledby="history-heading">
          <div className="section-heading">
            <h2 id="history-heading">练习记录</h2>
          </div>
          {historyError && <p className="error" role="alert">{historyError}</p>}
          {deleted && <div className="row">
            <span className="muted small" role="status">已删除种子 {deleted.seed} 的会话</span>
            <button disabled={updatingHistory} onClick={() => updateHistory(() => restoreDeletedGrammarSession(db, deleted.id))}>撤销删除</button>
          </div>}
          {data.sessions.length === 0 && <p className="empty-note">做过的练习会出现在这里。</p>}
          <ul className="cards session-list">
            {data.sessions.map((s) => {
              const rated = s.grammarQuiz ? answered.get(s.id) ?? 0 : s.order.filter((id) => data.base.has(id)).length
              return <li key={s.id}>
                <div className="session-title"><strong>{s.wordlistName}</strong><span className="badge">{STATUS[s.status]}</span></div>
                <div className="muted small">{s.grammarQuiz ? '已答' : '已评'} {rated} / {s.sampleSize} {unit} · {fmtTime(s.createdAt)}</div>
                <details>
                  <summary>练习设置</summary>
                  <p className="muted small">{SCOPE_LABEL[s.scope]} · {s.mode === 'sample' ? `随机抽取 ${s.sampleSize} ${unit}` : '全部练习'} · 种子 {s.seed} · {s.grammarQuiz ? '单选题' : grammar ? '翻卡自评' : FRAME_LABEL[s.frameType]}</p>
                </details>
                <div className="row session-links">
                  <button onClick={() => onOpen(s.id)}>{s.status === 'completed' && !s.quizFeedback ? '查看练习' : '继续练习'}</button>
                  <button className="link" onClick={() => onStats(s.id)}>{s.grammarQuiz ? '答题明细' : grammar ? '掌握报告' : '查看统计'}</button>
                  {grammar && !attemptedSessions.has(s.id) && <button className="link" disabled={updatingHistory} onClick={() => updateHistory(() => deleteUnansweredGrammarSession(db, s.id))}>删除会话</button>}
                </div>
              </li>
            })}
          </ul>
          {(onGrammarLibrary || onGrammarReport) && <div className="row">
            {onGrammarLibrary && <button onClick={onGrammarLibrary}>语法题库</button>}
            {onGrammarReport && <button onClick={onGrammarReport}>答题统计</button>}
          </div>}
        </section>
      </div>
    </div>
  )
}
