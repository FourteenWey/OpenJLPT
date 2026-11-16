import { useCallback, useEffect, useState } from 'react'
import type { Baseline, Grade, ReviewItem, Word } from '../types'
import { dueItems, listReviewItems, rateReview, undoLastReview } from '../db/review'
import { getBaselineMap } from '../db/queries'
import { getWords } from '../db/wordlists'
import { localDate, STAGE_LABELS } from '../lib/schedule'
import { speakWord, speakWordThenExample, stopSpeaking } from '../lib/tts'
import { Card, GradeBar } from './Card'
import { errText } from './useScanSession'
import { useApp } from './app-context'
import { useCardTimer, useHotkeys } from './hooks'

interface Loaded {
  queue: ReviewItem[]
  upcoming: [string, number][]
  words: Map<string, Word>
  base: Map<string, Baseline>
}

export function ReviewScreen() {
  const { db, version, bump } = useApp()
  const [data, setData] = useState<Loaded | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [paused, setPaused] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [run, setRun] = useState({ A: 0, B: 0, C: 0 })

  const load = useCallback(async () => {
    const [queue, all, base] = await Promise.all([dueItems(db), listReviewItems(db), getBaselineMap(db)])
    const today = localDate()
    const future = new Map<string, number>()
    for (const i of all) if (i.status === 'active' && i.dueDate > today) future.set(i.dueDate, (future.get(i.dueDate) ?? 0) + 1)
    const words = new Map((await getWords(db, queue.map((i) => i.wordId))).map((w) => [w.id, w]))
    setData({ queue, upcoming: [...future.entries()].sort(), words, base })
  }, [db])

  useEffect(() => {
    load().catch((e) => setMsg(errText(e)))
  }, [load, version])

  const item = data?.queue[0]
  const word = item ? data?.words.get(item.wordId) : undefined
  const timer = useCardTimer(item ? `${item.wordId}:${item.reviewCount}` : null, paused)

  const act = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setMsg('')
    try {
      await fn()
    } catch (e) {
      setMsg(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const speak = () => {
    if (word && revealed && !paused) speakWord(word).catch((e) => setMsg(errText(e)))
  }
  const reveal = () => {
    if (word && !revealed && !paused) {
      timer.markReveal()
      setRevealed(true)
      speakWordThenExample(word, word.example).catch((e) => setMsg(errText(e)))
    }
  }
  const grade = (g: Grade) => {
    if (!item || !revealed || paused) return
    stopSpeaking()
    return act(async () => {
      await rateReview(db, { wordId: item.wordId, grade: g, ...timer.read() })
      setRun((r) => ({ ...r, [g]: r[g] + 1 }))
      setRevealed(false)
      bump()
    })
  }
  const undo = () =>
    !paused &&
    act(async () => {
      const r = await undoLastReview(db)
      if (!r.ok) return setMsg(r.message)
      setRevealed(false)
      bump()
    })

  useHotkeys(
    { Space: () => (paused ? setPaused(false) : reveal()), KeyA: () => grade('A'), KeyS: () => grade('B'), KeyD: () => grade('C'), KeyR: speak, KeyZ: undo, 'Mod+KeyZ': undo, Backspace: undo, KeyP: () => setPaused((p) => !p) },
    !!data,
  )

  if (!data) return <p className="muted pad">{msg || '加载中…'}</p>
  return (
    <div className="scan">
      <header className="scan-head">
        <strong>错词复习</strong>
        <span className="muted small">今日到期 {data.queue.length} 词 · 本轮 A {run.A} / B {run.B} / C {run.C}</span>
        <span className="muted small">B、C 都算答错，会回到「当天」重测</span>
      </header>
      {item && word ? (
        <>
          <Card
            word={word}
            revealed={revealed}
            masked={paused}
            showExample
            onSpeak={speak}            badge={`复测 · ${STAGE_LABELS[item.stage]} · 首评 ${data.base.get(item.wordId)?.grade ?? '—'}${item.lapses ? ` · 已答错 ${item.lapses} 次` : ''}`}
          />
          <GradeBar enabled={revealed && !paused && !busy} onGrade={grade} />
        </>
      ) : (
        <section className="card done">
          <div className="card-word">今天没有到期的复习</div>
          {data.upcoming.length > 0 && <p className="muted">接下来：{data.upcoming.slice(0, 6).map(([d, n]) => `${d} · ${n} 词`).join('；')}</p>}
        </section>
      )}
      {msg && <p className="error" role="alert">{msg}</p>}
      <footer className="keyhints"><span><kbd>Space</kbd> 显示答案</span><span><kbd>Z</kbd> 撤销</span><span><kbd>P</kbd> {paused ? '继续' : '暂停'}</span></footer>
    </div>
  )
}
