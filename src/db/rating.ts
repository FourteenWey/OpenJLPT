// 首次基线评级：原子写入、首评只写一次、撤销上一步。
import type { Attempt, Baseline, Grade, ReviewItem, Session } from '../types'
import { newReviewItem } from '../lib/schedule'
import { uid } from '../lib/rng'
import { req, run } from './db'
import { firstUnrated } from './sessions'

let lastSeq = 0
/** 进程内严格递增；跨刷新时以时间戳为底，保证后写入的序号更大。 */
export function nextSeq(now: Date = new Date()): number {
  lastSeq = Math.max(lastSeq + 1, now.getTime())
  return lastSeq
}

export interface RateInput {
  sessionId: string
  wordId: string
  grade: Grade
  revealMs: number
  durationMs: number
}

export interface RateResult {
  ok: boolean
  /** ok 为 false 时的原因：该词首评已存在，本次不写入也不覆盖 */
  reason?: 'already-rated'
  session: Session
}

/**
 * 在一个事务里写入作答日志、首评、复习队列并推进游标。
 * baselines 用 add() 写入：键已存在会触发 ConstraintError，整个事务回滚，首评不可能被覆盖。
 */
export function rateBaseline(db: IDBDatabase, input: RateInput, now: Date = new Date()): Promise<RateResult> {
  return run(db, ['sessions', 'attempts', 'baselines', 'reviewItems'], 'readwrite', async (tx) => {
    const sessions = tx.objectStore('sessions')
    const baselines = tx.objectStore('baselines')
    const session = (await req(sessions.get(input.sessionId))) as Session | undefined
    if (!session) throw new Error('会话不存在')
    if (session.status !== 'active') throw new Error('会话不在进行中（已暂停或已完成）')
    const pos = session.order.indexOf(input.wordId)
    if (pos < 0) throw new Error('该词不在本次会话的抽样顺序中')

    const rated = new Set((await req(baselines.getAllKeys())) as string[])
    const iso = now.toISOString()
    const ok = !rated.has(input.wordId)
    if (ok) {
      const attempt: Attempt = {
        id: uid(),
        seq: nextSeq(now),
        kind: 'baseline',
        sessionId: session.id,
        wordId: input.wordId,
        grade: input.grade,
        answeredAt: iso,
        revealMs: Math.max(0, Math.round(input.revealMs)),
        durationMs: Math.max(0, Math.round(input.durationMs)),
      }
      const baseline: Baseline = {
        wordId: input.wordId,
        grade: input.grade,
        attemptId: attempt.id,
        sessionId: session.id,
        wordlistId: session.wordlistId,
        ratedAt: iso,
        durationMs: attempt.durationMs,
      }
      await req(tx.objectStore('attempts').add(attempt))
      await req(baselines.add(baseline))
      if (input.grade !== 'A') {
        const queue = tx.objectStore('reviewItems')
        if (!(await req(queue.get(input.wordId)))) await req(queue.add(newReviewItem(input.wordId, input.grade, now)))
      }
      rated.add(input.wordId)
    }
    const next = firstUnrated(session.order, rated, pos + 1)
    const updated: Session = {
      ...session,
      cursor: next < 0 ? pos : next,
      status: next < 0 ? 'completed' : 'active',
      completedAt: next < 0 ? iso : undefined,
      activeMs: session.activeMs + (ok ? Math.max(0, Math.round(input.durationMs)) : 0),
      updatedAt: iso,
    }
    await req(sessions.put(updated))
    return { ok, reason: ok ? undefined : 'already-rated', session: updated } as RateResult
  })
}

export type UndoResult = { ok: true; wordId: string; session: Session } | { ok: false; message: string }

/** 撤销本会话最近一次未撤销的评级：日志标记为已撤销（保留审计），移除它产生的首评与复习项。 */
export function undoLastBaseline(db: IDBDatabase, sessionId: string, now: Date = new Date()): Promise<UndoResult> {
  return run(db, ['sessions', 'attempts', 'baselines', 'reviewItems'], 'readwrite', async (tx) => {
    const session = (await req(tx.objectStore('sessions').get(sessionId))) as Session | undefined
    if (!session) throw new Error('会话不存在')
    const attempts = tx.objectStore('attempts')
    const mine = (await req(attempts.index('bySession').getAll(sessionId))) as Attempt[]
    const last = mine.filter((a) => !a.revoked).sort((a, b) => a.seq - b.seq).at(-1)
    if (!last) return { ok: false, message: '没有可撤销的操作' } as UndoResult

    const queue = tx.objectStore('reviewItems')
    const item = (await req(queue.get(last.wordId))) as ReviewItem | undefined
    if (item && item.reviewCount > 0) return { ok: false, message: '该词已进入复习，首评不能再撤销' } as UndoResult

    await req(attempts.put({ ...last, revoked: true }))
    const base = (await req(tx.objectStore('baselines').get(last.wordId))) as Baseline | undefined
    if (base?.attemptId === last.id) await req(tx.objectStore('baselines').delete(last.wordId))
    if (item) await req(queue.delete(last.wordId))

    const updated: Session = {
      ...session,
      cursor: Math.max(0, session.order.indexOf(last.wordId)),
      status: 'active',
      completedAt: undefined,
      activeMs: Math.max(0, session.activeMs - last.durationMs),
      updatedAt: now.toISOString(),
    }
    await req(tx.objectStore('sessions').put(updated))
    return { ok: true, wordId: last.wordId, session: updated } as UndoResult
  })
}
