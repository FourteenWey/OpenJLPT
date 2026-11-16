import { useCallback, useEffect, useState } from 'react'
import type { Attempt, Baseline, Grade, Session, Word } from '../types'
import { getSession, jumpTo, setSessionStatus } from '../db/sessions'
import { rateBaseline, undoLastBaseline } from '../db/rating'
import { getBaselineMap, getSessionAttempts } from '../db/queries'
import { getWords } from '../db/wordlists'
import { speakWord, speakWordThenExample, stopSpeaking } from '../lib/tts'
import { useApp } from './app-context'
import { useCardTimer, useHotkeys } from './hooks'

export type Panel = null | 'history' | 'jump' | 'help'
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 基线会话的全部状态与操作；界面只负责渲染。 */
export function useScanSession(sessionId: string) {
  const { db, bump } = useApp()
  const [session, setSession] = useState<Session | null>(null)
  const [words, setWords] = useState(new Map<string, Word>())
  const [baselines, setBaselines] = useState(new Map<string, Baseline>())
  const [log, setLog] = useState<Attempt[]>([])
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  const [msg, setMsg] = useState('')

  const refresh = useCallback(async () => {
    const [b, l] = await Promise.all([getBaselineMap(db), getSessionAttempts(db, sessionId)])
    setBaselines(b)
    setLog(l)
  }, [db, sessionId])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const s = await getSession(db, sessionId)
      if (!s) throw new Error('会话不存在')
      const ws = await getWords(db, s.order)
      await refresh()
      if (!alive) return
      setWords(new Map(ws.map((w) => [w.id, w])))
      setSession(s)
    })().catch((e) => setMsg(errText(e)))
    return () => {
      alive = false
    }
  }, [db, sessionId, refresh])

  const current = session ? words.get(session.order[session.cursor]) : undefined
  const paused = session?.status === 'paused'
  const done = session?.status === 'completed'
  const timer = useCardTimer(current && !done ? `${sessionId}:${current.id}` : null, paused || panel !== null)

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
    if (current && revealed && !paused && !done && !panel) speakWord(current).catch((e) => setMsg(errText(e)))
  }
  const reveal = () => {
    if (current && !revealed && !paused && !done && !panel) {
      timer.markReveal()
      setRevealed(true)
      speakWordThenExample(current, session?.hint === 'example' ? current.example : undefined).catch((e) => setMsg(errText(e)))
    }
  }
  const grade = (g: Grade) => {
    if (!current || !revealed || paused || done || panel) return
    stopSpeaking()
    return act(async () => {
      const res = await rateBaseline(db, { sessionId, wordId: current.id, grade: g, ...timer.read() })
      setSession(res.session)
      setRevealed(false)
      await refresh()
      bump()
    })
  }
  const undo = () => {
    if (!session || paused || panel) return
    return act(async () => {
      const r = await undoLastBaseline(db, sessionId)
      if (!r.ok) return setMsg(r.message)
      setSession(r.session)
      setRevealed(false)
      await refresh()
      bump()
    })
  }
  const togglePause = () => {
    if (!session || done || panel) return
    return act(async () => setSession(await setSessionStatus(db, sessionId, paused ? 'active' : 'paused')))
  }
  const jump = (n: number) =>
    act(async () => {
      setSession(await jumpTo(db, sessionId, n))
      setRevealed(false)
      setPanel(null)
    })
  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p))

  useHotkeys(
    {
      Space: () => (paused ? togglePause() : reveal()),
      KeyA: () => grade('A'),
      KeyS: () => grade('B'),
      KeyD: () => grade('C'),
      KeyR: speak,
      KeyZ: undo,
      'Mod+KeyZ': undo,
      Backspace: undo,
      KeyP: togglePause,
      KeyG: () => !paused && !done && setPanel('jump'),
      KeyH: () => toggle('history'),
      'Shift+Slash': () => toggle('help'),
      Escape: () => setPanel(null),
    },
    !!session,
  )

  return { session, words, baselines, log, current, revealed, busy, panel, msg, paused, done, setPanel, reveal, speak, grade, undo, togglePause, jump }
}
