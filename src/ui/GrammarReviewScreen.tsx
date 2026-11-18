import { useRef, useState } from 'react'
import { dueItems, listReviewItems, undoLastReview } from '../db/review'
import { dismissGrammarFeedback, getGrammarFeedback, rateGrammarReview } from '../db/grammarReview'
import { grammarById } from '../lib/grammar'
import { getGrammarQuestion, grammarQuestions } from '../lib/grammarQuiz'
import { localDate, STAGE_LABELS } from '../lib/schedule'
import { fnv1a } from '../lib/rng'
import { useApp } from './app-context'
import { useLoad } from './useLoad'
import { useCardTimer, useHotkeys } from './hooks'
import { useGrammarAudio } from './useGrammarAudio'
import { GrammarQuestionCard } from './GrammarQuestionCard'
import { errText } from './useScanSession'
import { GrammarLevelSelect } from './GrammarFilters'

export function GrammarReviewScreen() {
  const { db, version, bump } = useApp()
  const [level, setLevel] = useState('')
  const [paused, setPaused] = useState(false)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const submitted = useRef(new Set<string>())
  const [msg, setMsg] = useState('')
  const [run, setRun] = useState({ correct: 0, wrong: 0 })
  const { data, error } = useLoad(async () => ({
    queue: await dueItems(db, new Date(), 'grammar'), all: await listReviewItems(db, 'grammar'), feedback: await getGrammarFeedback(db),
  }), [db, version])
  const queue = data?.queue.filter((i) => grammarQuestions.has(i.wordId) && (!level || grammarById.get(i.wordId)?.level === level)) ?? []
  const feedback = data?.feedback
  const item = feedback?.prev ?? queue[0]
  const question = item ? getGrammarQuestion(item.wordId, parseInt(fnv1a(`${item.enteredAt}:${item.reviewCount}`), 16)) : undefined
  const timer = useCardTimer(item && !feedback ? `${item.wordId}:${item.reviewCount}` : null, paused || !!feedback)
  const speak = useGrammarAudio({ questionId: item?.wordId, question, feedback,
    nextId: queue[feedback ? 0 : 1]?.wordId, paused, blocked: false, onError: setMsg })
  const act = async (fn: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setMsg('')
    try { await fn(); bump() } catch (e) { setMsg(errText(e)) } finally { lock.current = false; setBusy(false) }
  }
  const choose = (index: number) => {
    if (!item || !question || feedback || paused) return
    const choice = question.options[index]
    if (choice === undefined) return
    return act(async () => {
      const a = await rateGrammarReview(db, { wordId: item.wordId, choice, expectedReviewCount: item.reviewCount, durationMs: timer.read().durationMs })
      submitted.current.add(a.id)
      setRun((r) => ({ ...r, [a.grade === 'A' ? 'correct' : 'wrong']: r[a.grade === 'A' ? 'correct' : 'wrong'] + 1 }))
    })
  }
  const next = () => feedback && !paused && act(() => dismissGrammarFeedback(db, feedback.id))
  const undo = () => !paused && act(async () => {
    const result = await undoLastReview(db, 'grammar')
    if (!result.ok) throw new Error(result.message)
    if (submitted.current.delete(result.attemptId)) setRun((r) => ({ ...r, [result.grade === 'A' ? 'correct' : 'wrong']: r[result.grade === 'A' ? 'correct' : 'wrong'] - 1 }))
  })
  useHotkeys({ KeyA: () => choose(0), KeyB: () => choose(1), KeyC: () => choose(2), KeyD: () => choose(3),
    Space: () => paused ? setPaused(false) : next(), KeyR: speak, KeyP: () => setPaused((p) => !p), KeyZ: undo, 'Mod+KeyZ': undo, Backspace: undo }, !!data)
  if (!data) return <p className="muted pad">{error || '加载中…'}</p>
  const future = new Map<string, number>()
  for (const i of data.all) if (i.status === 'active' && i.dueDate > localDate() && (!level || grammarById.get(i.wordId)?.level === level)) {
    future.set(i.dueDate, (future.get(i.dueDate) ?? 0) + 1)
  }
  const missing = data.queue.filter((i) => !grammarQuestions.has(i.wordId)).length
  return <div className="scan">
    <header className="scan-head"><strong>语法错题复习</strong><span className="muted small">今日待复习 {queue.length} 题 · 本轮答对 {run.correct} / 答错 {run.wrong}</span></header>
    <div className="row"><fieldset className="review-level-filter" disabled={busy || !!feedback}><GrammarLevelSelect value={level} onChange={(v) => { setLevel(v); setPaused(false) }} /></fieldset>
      {item && <span className="muted small">复测 · {STAGE_LABELS[item.stage]} · {grammarById.get(item.wordId)?.level}</span>}</div>
    <p className="muted small">到期答对推进阶段，答错当天再练；完成最后阶段后毕业。</p>
    {paused ? <section className="card"><h2>已暂停</h2><button onClick={() => setPaused(false)}>继续 Space</button></section>
      : question ? <GrammarQuestionCard question={question} feedback={feedback} disabled={busy} last={false} onChoose={choose} onNext={next} onSpeak={speak} />
        : <section className="card done"><h2>今天没有到期的语法复习</h2>
          {future.size > 0 && <p className="muted">接下来：{[...future].sort().slice(0, 6).map(([date, n]) => `${date} · ${n} 题`).join('；')}</p>}
        </section>}
    {missing > 0 && <p className="notice">{missing} 道历史题目在当前题库中不可用，已保留其学习记录并跳过复习。</p>}
    {(msg || error) && <p className="error" role="alert">{msg || error}</p>}
    <footer className="keyhints">
      <button className="link" disabled={busy || paused} onClick={() => void undo()}>Z 撤销复习</button>
      <button className="link" disabled={busy} onClick={() => setPaused((p) => !p)}>P {paused ? '继续' : '暂停'}</button>
      <span>A / B / C / D 选择 · Space 下一题 · R 重播</span>
    </footer>
  </div>
}
