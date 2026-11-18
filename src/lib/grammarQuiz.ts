import { quizItems } from '../data/grammar-quiz'
import type { Attempt, JlptLevel, StudyFrame } from '../types'
import { grammarById, grammarFrames } from './grammar'
import { fnv1a, seededShuffle } from './rng'

export type QuizItem = [
  pattern: string, prompt: string, answer: string, distractors: [string, string, string], explanation: string,
]

export const CHOICE_KEYS = ['A', 'B', 'C', 'D'] as const
export const QUIZ_BLANK = '＿＿＿'

export const grammarQuestions = new Map<string, { prompt: string; answer: string; options: string[]; explanation: string }>(
  (Object.entries(quizItems) as [JlptLevel, QuizItem[]][]).flatMap(([level, items]) =>
    items.map(([pattern, prompt, answer, distractors, explanation]) => [
      `${level}:${pattern}`, { prompt, answer, options: [answer, ...distractors], explanation },
    ] as const),
  ),
)

export const grammarQuizFrames: StudyFrame[] = grammarFrames.map((frame) => ({
  ...frame,
  frameType: 'curated',
  wordIds: frame.wordIds.filter((id) => grammarQuestions.has(id)),
}))

export function getGrammarQuestion(id: string, seed: number) {
  const item = grammarQuestions.get(id)
  const point = grammarById.get(id)
  if (!item || !point) return
  return { ...item, pattern: point.pattern, options: seededShuffle(item.options, seed ^ parseInt(fnv1a(id), 16)) }
}

export function quizAnswers(attempts: readonly Attempt[]) {
  return attempts.filter((a) => a.kind === 'grammar-quiz' && !a.revoked)
}
