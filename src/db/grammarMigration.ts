import type { Attempt, ReviewItem } from '../types'
import { grammarQuestions } from '../lib/grammarQuiz'
import { resetGrammarReview } from '../lib/schedule'
import { req, run } from './db'

export const GRAMMAR_MIGRATION_KEY = 'grammar-review-v3'
export const GRAMMAR_FEEDBACK_KEY = 'grammar-review-feedback'
export interface GrammarMigration { count: number; date: string; noticePending: boolean }

/** 在已有事务内补入历史快筛错误，同时补齐撤销快照；不产生复习作答。 */
export async function backfillGrammarReview(tx: IDBTransaction, now = new Date()): Promise<void> {
  const settings = tx.objectStore('settings')
  if (await req(settings.get(GRAMMAR_MIGRATION_KEY))) return
  const attempts = tx.objectStore('attempts')
  const history = ((await req(attempts.getAll())) as Attempt[])
    .filter((a) => a.subject === 'grammar' && a.kind === 'grammar-quiz' && !a.revoked)
    .sort((a, b) => a.seq - b.seq)
  const items = new Map<string, ReviewItem>()
  for (const attempt of history) {
    if (!grammarQuestions.has(attempt.wordId)) continue
    const prev = items.get(attempt.wordId)
    await req(attempts.put({ ...attempt, prev }))
    if (attempt.grade !== 'A') items.set(attempt.wordId, resetGrammarReview(attempt.wordId, prev, now))
  }
  for (const item of items.values()) await req(tx.objectStore('grammarReviewItems').put(item))
  await req(settings.put({ key: GRAMMAR_MIGRATION_KEY, value: {
    count: items.size, date: now.toISOString(), noticePending: items.size > 0,
  } satisfies GrammarMigration }))
}

export function ensureGrammarReview(db: IDBDatabase): Promise<void> {
  return run(db, ['settings', 'attempts', 'grammarReviewItems'], 'readwrite', (tx) => backfillGrammarReview(tx))
}
