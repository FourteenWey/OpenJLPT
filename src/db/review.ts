// 错词复习：到期队列、复测评级、撤销。
import type { Attempt, Grade, ReviewItem } from '../types'
import { applyReview, isDue, localDate, sortDue } from '../lib/schedule'
import { uid } from '../lib/rng'
import { getAll, req, run } from './db'
import { nextSeq } from './rating'

export const REVIEW_SESSION_ID = 'review'

export const listReviewItems = (db: IDBDatabase) => getAll<ReviewItem>(db, 'reviewItems')

export async function dueItems(db: IDBDatabase, now: Date = new Date()): Promise<ReviewItem[]> {
  const today = localDate(now)
  return sortDue((await listReviewItems(db)).filter((i) => isDue(i, today)))
}

export interface ReviewInput {
  wordId: string
  grade: Grade
  revealMs: number
  durationMs: number
}

/** 复测评级：只改复习队列与作答日志，永远不触碰 baselines。 */
export function rateReview(db: IDBDatabase, input: ReviewInput, now: Date = new Date()): Promise<ReviewItem> {
  return run(db, ['reviewItems', 'attempts'], 'readwrite', async (tx) => {
    const queue = tx.objectStore('reviewItems')
    const item = (await req(queue.get(input.wordId))) as ReviewItem | undefined
    if (!item || item.status !== 'active') throw new Error('该词不在复习队列中')
    const next = applyReview(item, input.grade, now)
    const attempt: Attempt = {
      id: uid(),
      seq: nextSeq(now),
      kind: 'review',
      sessionId: REVIEW_SESSION_ID,
      wordId: input.wordId,
      grade: input.grade,
      stage: item.stage,
      answeredAt: now.toISOString(),
      revealMs: Math.max(0, Math.round(input.revealMs)),
      durationMs: Math.max(0, Math.round(input.durationMs)),
      prev: item,
    }
    await req(tx.objectStore('attempts').add(attempt))
    await req(queue.put(next))
    return next
  })
}

export type ReviewUndo = { ok: true; wordId: string } | { ok: false; message: string }

export function undoLastReview(db: IDBDatabase): Promise<ReviewUndo> {
  return run(db, ['reviewItems', 'attempts'], 'readwrite', async (tx) => {
    const attempts = tx.objectStore('attempts')
    const all = (await req(attempts.index('bySession').getAll(REVIEW_SESSION_ID))) as Attempt[]
    const last = all.filter((a) => !a.revoked).sort((a, b) => a.seq - b.seq).at(-1)
    if (!last?.prev) return { ok: false, message: '没有可撤销的复习操作' } as ReviewUndo
    await req(attempts.put({ ...last, revoked: true }))
    await req(tx.objectStore('reviewItems').put(last.prev))
    return { ok: true, wordId: last.wordId } as ReviewUndo
  })
}
