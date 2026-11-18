import type { Attempt, ReviewItem } from '../types'
import { grammarQuestions } from '../lib/grammarQuiz'
import { applyReview, isDue, localDate } from '../lib/schedule'
import { uid } from '../lib/rng'
import { getSetting, req, run } from './db'
import { nextSeq } from './rating'
import { GRAMMAR_FEEDBACK_KEY } from './grammarMigration'

export async function getGrammarFeedback(db: IDBDatabase): Promise<Attempt | undefined> {
  const id = await getSetting<string>(db, GRAMMAR_FEEDBACK_KEY)
  if (!id) return
  return run(db, ['attempts'], 'readonly', async (tx) => {
    const a = await req<Attempt | undefined>(tx.objectStore('attempts').get(id))
    return a?.subject === 'grammar' && a.kind === 'review' && !a.revoked ? a : undefined
  })
}

export function rateGrammarReview(db: IDBDatabase, input: {
  wordId: string; choice: string; expectedReviewCount: number; durationMs: number
}, now = new Date()): Promise<Attempt> {
  return run(db, ['grammarReviewItems', 'attempts', 'settings'], 'readwrite', async (tx) => {
    const settings = tx.objectStore('settings')
    if (await req(settings.get(GRAMMAR_FEEDBACK_KEY))) throw new Error('请先继续当前题目')
    const queue = tx.objectStore('grammarReviewItems')
    const item = await req<ReviewItem | undefined>(queue.get(input.wordId))
    if (!item || !isDue(item, localDate(now)) || item.reviewCount !== input.expectedReviewCount) throw new Error('复习进度已更新，请刷新后重试')
    const question = grammarQuestions.get(input.wordId)
    if (!question?.options.includes(input.choice)) throw new Error('请选择有效的选项')
    const grade = input.choice === question.answer ? 'A' : 'C'
    const attempt: Attempt = {
      id: uid(), seq: nextSeq(now), subject: 'grammar', kind: 'review', sessionId: 'grammar-review',
      wordId: input.wordId, choice: input.choice, grade, stage: item.stage, prev: item,
      answeredAt: now.toISOString(), durationMs: Math.max(0, Math.round(input.durationMs)),
      revealMs: Math.max(0, Math.round(input.durationMs)),
    }
    await req(tx.objectStore('attempts').add(attempt))
    await req(queue.put(applyReview(item, grade, now)))
    await req(settings.put({ key: GRAMMAR_FEEDBACK_KEY, value: attempt.id }))
    return attempt
  })
}

export function dismissGrammarFeedback(db: IDBDatabase, attemptId: string): Promise<void> {
  return run(db, ['settings'], 'readwrite', async (tx) => {
    const settings = tx.objectStore('settings')
    const feedback = await req(settings.get(GRAMMAR_FEEDBACK_KEY))
    if (feedback?.value === attemptId) await req(settings.delete(GRAMMAR_FEEDBACK_KEY))
  })
}
