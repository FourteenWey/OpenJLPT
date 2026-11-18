import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { Attempt } from '../types'
import { grammarQuestions, QUIZ_BLANK, type getGrammarQuestion } from '../lib/grammarQuiz'
import { getSpeed, getTtsSettings, prefetchKana, speakText, stopSpeaking, subscribeTtsSettings, ttsEnabled } from '../lib/tts'

/** 快筛和到期复习共用：提前准备正确句，提交后播放，并取消离开的题目。 */
export function useGrammarAudio({ questionId, question, feedback, nextId, paused, blocked, onError }: {
  questionId?: string
  question?: ReturnType<typeof getGrammarQuestion>
  feedback?: Attempt
  nextId?: string
  paused: boolean
  blocked: boolean
  onError: (message: string) => void
}) {
  const settings = useSyncExternalStore(subscribeTtsSettings, getTtsSettings)
  const text = question?.prompt.replace(QUIZ_BLANK, question.answer)
  const errorHandler = useRef(onError)
  errorHandler.current = onError
  const spoken = useRef<string | undefined>(undefined)
  const generation = useRef(0)

  useEffect(() => {
    if (!questionId || !text || paused || !ttsEnabled()) return
    const controller = new AbortController()
    void (async () => {
      await prefetchKana({ wordId: `${questionId}:grammar-answer`, kana: text, speed: getSpeed() }, controller.signal)
      if (controller.signal.aborted) return
      const next = nextId ? grammarQuestions.get(nextId) : undefined
      if (next) await prefetchKana({ wordId: `${nextId}:grammar-answer`, kana: next.prompt.replace(QUIZ_BLANK, next.answer), speed: getSpeed() }, controller.signal)
    })()
    return () => controller.abort()
  }, [questionId, text, nextId, paused, settings])

  useEffect(() => {
    if (!questionId) return
    generation.current++
    stopSpeaking()
    return () => { generation.current++; stopSpeaking() }
  }, [questionId, feedback?.id, paused, blocked, settings])

  const speak = () => {
    if (!questionId || !text || !feedback || paused || blocked) return
    const id = generation.current
    void speakText(`${questionId}:grammar-answer`, text).catch((error: unknown) => {
      if (id === generation.current) errorHandler.current(error instanceof Error ? error.message : String(error))
    })
  }

  useEffect(() => {
    if (!feedback || paused || blocked || spoken.current === feedback.id) return
    spoken.current = feedback.id
    speak()
  }, [questionId, text, feedback?.id, paused, blocked, settings])

  return speak
}
