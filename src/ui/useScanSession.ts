import { useCallback, useEffect, useRef, useState } from 'react'
import type { Attempt, Baseline, Grade, Session, StudySubject, Word } from '../types'
import { dismissQuizFeedback, jumpTo, resumeSession, setSessionStatus } from '../db/sessions'
import { rateBaseline, undoLastBaseline, type RateInput } from '../db/rating'
import { getBaselineMap, getSessionAttempts } from '../db/queries'
import { getWords } from '../db/wordlists'
import { grammarById } from '../lib/grammar'
import { getGrammarQuestion, quizAnswers } from '../lib/grammarQuiz'
import { speakWord, speakWordThenExample, stopSpeaking } from '../lib/tts'
import { useGrammarAudio } from './useGrammarAudio'
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
  const saving = useRef(false)
  const [panel, setPanel] = useState<Panel>(null)
  const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false)
  const [msg, setMsg] = useState('')

  const refresh = useCallback(async (subject?: StudySubject) => {
    const [b, l] = await Promise.all([getBaselineMap(db, subject), getSessionAttempts(db, sessionId)])
    setBaselines(b)
    setLog(l)
  }, [db, sessionId])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const s = await resumeSession(db, sessionId)
      const ws = s.subject === 'grammar' ? [] : await getWords(db, s.order)
      await refresh(s.subject)
      if (!alive) return
      setWords(new Map(ws.map((w) => [w.id, w])))
      setSession(s)
    })().catch((e) => setMsg(errText(e)))
    return () => {
      alive = false
    }
  }, [db, sessionId, refresh])

  const currentId = session?.order[session.cursor]
  const current = currentId ? words.get(currentId) : undefined
  const quiz = session?.grammarQuiz
  const questionId = session?.quizFeedback?.wordId ?? currentId
  const question = session && quiz && questionId ? getGrammarQuestion(questionId, session.seed) : undefined
  const answers = quiz ? quizAnswers(log) : []
  const feedback = session?.quizFeedback ? answers.find((a) => a.id === session.quizFeedback?.attemptId) : undefined
  const grammarPoint = !quiz && session?.subject === 'grammar' && currentId ? grammarById.get(currentId) : undefined
  const hasCard = !!(current || grammarPoint || question)
  const paused = session?.status === 'paused'
  const done = session?.status === 'completed' && !session.quizFeedback
  const timer = useCardTimer(hasCard && !done && !session?.quizFeedback ? `${sessionId}:${currentId}` : null,
    paused || panel !== null || bookmarkDialogOpen || !!session?.quizFeedback)
  const nextId = quiz && session ? session.order[session.cursor + (session.quizFeedback ? 0 : 1)] : undefined
  const speakGrammar = useGrammarAudio({ questionId: quiz && !done ? questionId : undefined, question, feedback,
    nextId, paused, blocked: !!panel || !!done, onError: setMsg })

  const act = async (fn: () => Promise<void>) => {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setMsg('')
    try {
      await fn()
    } catch (e) {
      setMsg(errText(e))
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  const speak = () => {
    if (quiz) return speakGrammar()
    if (current && revealed && !paused && !done && !panel) speakWord(current).catch((e) => setMsg(errText(e)))
  }
  const reveal = () => {
    if (hasCard && !revealed && !paused && !done && !panel && !saving.current) {
      timer.markReveal()
      setRevealed(true)
      if (current) speakWordThenExample(current, session?.hint === 'example' ? current.example : undefined).catch((e) => setMsg(errText(e)))
    }
  }
  const saveAnswer = (input: RateInput) =>
    act(async () => {
      const res = await rateBaseline(db, input)
      setSession(res.session)
      setRevealed(false)
      await refresh(res.session.subject)
      bump()
    })

  const grade = (g: Grade) => {
    if (quiz || !currentId || !hasCard || !revealed || paused || done || panel) return
    if (current) stopSpeaking()
    return saveAnswer({ sessionId, wordId: currentId, grade: g, ...timer.read() })
  }
  const choose = (index: number) => {
    if (!currentId || !question || session?.quizFeedback || paused || done || panel) return
    const choice = question.options[index]
    if (choice === undefined) return
    const { durationMs } = timer.read()
    return saveAnswer({ sessionId, wordId: currentId, choice, durationMs, revealMs: durationMs })
  }
  const nextQuestion = () => {
    if (!session?.quizFeedback || !feedback || panel) return
    return act(async () => setSession(await dismissQuizFeedback(db, sessionId, feedback.id)))
  }
  const undo = () => {
    if (!session || paused || panel) return
    return act(async () => {
      const r = await undoLastBaseline(db, sessionId)
      if (!r.ok) return setMsg(r.message)
      setSession(r.session)
      setRevealed(false)
      await refresh(r.session.subject)
      bump()
    })
  }
  const togglePause = () => {
    if (!session || done || session.quizFeedback || panel) return
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
      Space: paused ? togglePause : quiz ? (feedback ? nextQuestion : undefined) : reveal,
      KeyA: quiz ? () => choose(0) : () => grade('A'),
      KeyB: quiz ? () => choose(1) : undefined,
      KeyC: quiz ? () => choose(2) : undefined,
      KeyD: quiz ? () => choose(3) : () => grade('C'),
      KeyS: quiz ? undefined : () => grade('B'),
      KeyR: speak,
      KeyZ: undo,
      'Mod+KeyZ': undo,
      Backspace: undo,
      KeyP: togglePause,
      KeyG: () => !paused && !done && !session?.quizFeedback && setPanel('jump'),
      KeyH: () => toggle('history'),
      'Shift+Slash': () => toggle('help'),
    },
    !!session,
  )

  return { session, words, baselines, log, current, grammarPoint, question, answers, feedback, revealed, busy, panel, msg, paused, done, setPanel, setBookmarkDialogOpen, reveal, speak, grade, choose, nextQuestion, undo, togglePause, jump }
}
