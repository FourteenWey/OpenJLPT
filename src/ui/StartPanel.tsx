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

interface Props {
  onOpen: (sessionId: string) => void
  onStats: (sessionId: string) => void
  subject?: StudySubject
  onGrammarReport?: () => void
  onGrammarLibrary?: () => void
}

const STATUS = { active: '进行中', paused: '已暂停', completed: '已完成' } as const

export function StartPanel({ onOpen, onStats, subject = 'vocabulary', onGrammarReport, onGrammarLibrary }: Props) {
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

  if (!data) return <p className="muted pad">{error || '加载中…'}</p>
  const list = selectWordlist(data.lists, listId)
  if (!list) return <p className="pad">还没有词表。请先到「数据」页载入 OpenJLPT 词表或导入你自己的 CSV/JSON。</p>
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
    <div className="panel">
      <h2>{grammar ? '语法速筛' : '单词快筛'}</h2>
      <div className="form">
        <label>
          {grammar ? '语法级别' : '样本框（词表）'}
          <select value={list.id} onChange={(e) => setListId(e.target.value)}>
            {data.lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}{!l.scope.endsWith('-only') && ` · ${SCOPE_LABEL[l.scope]}`} · {l.wordIds.length} {unit}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>方式</legend>
          <label className="inline"><input type="radio" checked={mode === 'sample'} onChange={() => setMode('sample')} /> 随机抽样</label>
          <label className="inline"><input type="radio" checked={mode === 'census'} onChange={() => setMode('census')} /> {grammar ? '全部题目' : '全量普查'}（{list.wordIds.length} {unit}）</label>
        </fieldset>
        {mode === 'sample' && (
          <div className="row">
            <label>样本量<input type="number" min={1} max={list.wordIds.length} value={size} onChange={(e) => setSize(e.target.value)} /></label>
            <label>随机种子（可选）<input value={seedText} placeholder="留空则自动生成并记录" onChange={(e) => setSeedText(e.target.value)} /></label>
          </div>
        )}
        {!grammar && <>
          <label className="inline">
            <input type="checkbox" checked={hint} onChange={(e) => setHint(e.target.checked)} />
            词形下方显示例句，帮助判断读音
          </label>
          <p className="muted small">
            例句来自 Tatoeba，按词形匹配，个别多音词的句子读音可能与词条不同，以答案面的读音为准。有例句提示时更容易想起词义，掌握率会比只看词形偏高，
            条件会记录在会话里；想和之前的结果比较，请保持同样的设置。没有例句的词只显示词形。
          </p>
        </>}
        <p className="muted small">
          {grammar ? '根据例句或对话选 A、B、C、D，提交后查看中文解析。每次会话独立计分，可以重做。' : <>
            {list.scope.endsWith('-only') && `范围：${SCOPE_LABEL[list.scope]} 级别词汇。`}
            {list.scope === 'N5-N3-cumulative' && '范围：N5、N4、N3 累计词汇；统计页会按级别分开列出。'}
            {list.scope === 'custom' && '范围：自定义词表。'}
            {list.frameType === 'curated' ? ' 该词表为人工挑选，结果不推断总体。' : mode === 'sample' ? ' 无放回随机抽取；答完后给出 95% 置信区间。' : ''}
            {' '}已有首评的词会沿用原评级，不再询问。
          </>}
        </p>
        <div className="row">
          <button className="primary" onClick={start} disabled={starting || !list.wordIds.length}>{grammar ? '开始语法速筛' : '开始'}</button>
          {onGrammarLibrary && <button onClick={onGrammarLibrary}>语法题库</button>}
          {onGrammarReport && <button onClick={onGrammarReport}>答题统计</button>}
        </div>
        {msg && <p className="error" role="alert">{msg}</p>}
      </div>

      <h2>历史会话</h2>
      {historyError && <p className="error" role="alert">{historyError}</p>}
      {deleted && (
        <div className="row">
          <span className="muted small" role="status">已删除种子 {deleted.seed} 的会话</span>
          <button disabled={updatingHistory} onClick={() => updateHistory(() => restoreDeletedGrammarSession(db, deleted.id))}>撤销删除</button>
        </div>
      )}
      {data.sessions.length === 0 && <p className="muted">还没有会话。</p>}
      <ul className="cards">
        {data.sessions.map((s) => {
          const rated = s.grammarQuiz ? answered.get(s.id) ?? 0 : s.order.filter((id) => data.base.has(id)).length
          return (
            <li key={s.id}>
              <div>
                <strong>{s.wordlistName}</strong>{' '}
                {!s.scope.endsWith('-only') && <><span className={`badge scope-${s.scope}`}>{SCOPE_LABEL[s.scope]}</span>{' '}</>}
                <span className="muted small">{s.mode === 'sample' ? `抽样 n=${s.sampleSize}` : s.grammarQuiz ? '全部题目' : '全量普查'} · 种子 {s.seed} · {s.grammarQuiz ? '单选题' : grammar ? '翻卡自评' : FRAME_LABEL[s.frameType]}</span>
              </div>
              <div className="muted small">{STATUS[s.status]} · {s.grammarQuiz ? '已答' : '已评'} {rated}/{s.sampleSize} · 创建于 {fmtTime(s.createdAt)}</div>
              <div className="row">
                <button onClick={() => onOpen(s.id)}>{s.status === 'completed' && !s.quizFeedback ? '查看' : '继续'}</button>
                <button onClick={() => onStats(s.id)}>{s.grammarQuiz ? '答题明细' : grammar ? '掌握报告' : '统计'}</button>
                {grammar && !attemptedSessions.has(s.id) && (
                  <button disabled={updatingHistory} onClick={() => updateHistory(() => deleteUnansweredGrammarSession(db, s.id))}>删除会话</button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
