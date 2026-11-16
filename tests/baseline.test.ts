import { describe, expect, it } from 'vitest'
import { BUILTIN_IDS, ensureBuiltin } from '../src/db/builtin'
import { createSession, getSession, jumpTo, listSessions, setSessionStatus } from '../src/db/sessions'
import { rateBaseline, undoLastBaseline } from '../src/db/rating'
import { dueItems, listReviewItems, rateReview, undoLastReview } from '../src/db/review'
import { getBaselineMap, getSessionAttempts } from '../src/db/queries'
import { openDb, req, run } from '../src/db/db'
import { fsFetcher, freshDb, uniqueDbName } from './helpers'

async function setup() {
  const db = await freshDb()
  await ensureBuiltin(db, 'n3', fsFetcher)
  return db
}
const rate = (db: IDBDatabase, sessionId: string, wordId: string, grade: 'A' | 'B' | 'C', now?: Date) =>
  rateBaseline(db, { sessionId, wordId, grade, revealMs: 800, durationMs: 2000 }, now)

describe('抽样与会话', () => {
  it('相同种子得到相同样本，并记录样本框、样本量与抽取时间', async () => {
    const db = await setup()
    const a = await createSession(db, { wordlistId: BUILTIN_IDS.n3, mode: 'sample', sampleSize: 100, seed: 42 })
    const b = await createSession(db, { wordlistId: BUILTIN_IDS.n3, mode: 'sample', sampleSize: 100, seed: 42 })
    const c = await createSession(db, { wordlistId: BUILTIN_IDS.n3, mode: 'sample', sampleSize: 100, seed: 43 })
    expect(a.order).toEqual(b.order)
    expect(a.order).not.toEqual(c.order)
    expect(new Set(a.order).size).toBe(100)
    expect(a).toMatchObject({ frameSize: 1659, sampleSize: 100, seed: 42, scope: 'N3-only', mode: 'sample' })
    expect(a.frameHash).toMatch(/^[0-9a-f]{8}$/)
    expect(Number.isNaN(Date.parse(a.drawnAt))).toBe(false)
    expect(await listSessions(db)).toHaveLength(3)
  })

  it('普查按随机顺序无重复地遍历全部词', async () => {
    const db = await setup()
    const s = await createSession(db, { wordlistId: BUILTIN_IDS.n3, mode: 'census', seed: 7 })
    expect(s.order).toHaveLength(1659)
    expect(new Set(s.order).size).toBe(1659)
    await expect(createSession(db, { wordlistId: BUILTIN_IDS.n3, mode: 'sample', sampleSize: 0 })).rejects.toThrow('样本量')
  })
})

describe('首评写入、断点恢复与不可覆盖', () => {
  it('评级后重新打开数据库，进度、首评与复习队列都还在', async () => {
    const name = uniqueDbName()
    let db = await openDb(name)
    await ensureBuiltin(db, 'n3', fsFetcher)
    const s = await createSession(db, { wordlistId: BUILTIN_IDS.n3, mode: 'sample', sampleSize: 10, seed: 1 })
    await rate(db, s.id, s.order[0], 'A')
    await rate(db, s.id, s.order[1], 'B')
    await rate(db, s.id, s.order[2], 'C')
    db.close()

    db = await openDb(name)
    const restored = (await getSession(db, s.id))!
    expect(restored.cursor).toBe(3)
    expect(restored.status).toBe('active')
    const base = await getBaselineMap(db)
    expect([...base.values()].map((b) => b.grade).sort()).toEqual(['A', 'B', 'C'])
    expect((await listReviewItems(db)).map((r) => r.wordId).sort()).toEqual([s.order[1], s.order[2]].sort())
    expect(await getSessionAttempts(db, s.id)).toHaveLength(3)
  })

  it('同一词的首次评级不会被后续会话、复习成绩覆盖', async () => {
    const db = await setup()
    const first = await createSession(db, { wordlistId: BUILTIN_IDS.n3, mode: 'sample', sampleSize: 5, seed: 9 })
    const word = first.order[0]
    await rate(db, first.id, word, 'C')

    const second = await createSession(db, { wordlistId: BUILTIN_IDS.n3, mode: 'sample', sampleSize: 5, seed: 9 })
    expect(second.preRated).toBe(1)
    expect(second.cursor).toBe(1)
    const dup = await rate(db, second.id, word, 'A')
    expect(dup).toMatchObject({ ok: false, reason: 'already-rated' })

    await rateReview(db, { wordId: word, grade: 'A', revealMs: 500, durationMs: 1500 })
    const base = (await getBaselineMap(db)).get(word)!
    expect(base.grade).toBe('C')
    expect(base.sessionId).toBe(first.id)
    const item = (await listReviewItems(db)).find((i) => i.wordId === word)!
    expect(item).toMatchObject({ lastGrade: 'A', stage: 1 })
  })

  it('直接再次 add 同一词的首评会被存储层拒绝', async () => {
    const db = await setup()
    const s = await createSession(db, { wordlistId: BUILTIN_IDS.n3, mode: 'sample', sampleSize: 3, seed: 2 })
    await rate(db, s.id, s.order[0], 'A')
    const clash = run(db, ['baselines'], 'readwrite', async (tx) => {
      await req(tx.objectStore('baselines').add({ wordId: s.order[0], grade: 'C' }))
    })
    await expect(clash).rejects.toBeTruthy()
    expect((await getBaselineMap(db)).get(s.order[0])?.grade).toBe('A')
  })

  it('答完最后一个词后会话完成；暂停期间不能评级，恢复后可继续', async () => {
    const db = await setup()
    const s = await createSession(db, { wordlistId: BUILTIN_IDS.n3, mode: 'sample', sampleSize: 2, seed: 3 })
    await setSessionStatus(db, s.id, 'paused')
    await expect(rate(db, s.id, s.order[0], 'A')).rejects.toThrow('暂停')
    await setSessionStatus(db, s.id, 'active')
    await rate(db, s.id, s.order[0], 'A')
    const done = await rate(db, s.id, s.order[1], 'A')
    expect(done.session.status).toBe('completed')
    expect(done.session.completedAt).toBeTruthy()
  })
})

describe('撤销与跳转', () => {
  it('撤销移除首评与复习项，日志保留并标记已撤销，可重新评级', async () => {
    const db = await setup()
    const s = await createSession(db, { wordlistId: BUILTIN_IDS.n3, mode: 'sample', sampleSize: 5, seed: 5 })
    await rate(db, s.id, s.order[0], 'A')
    await rate(db, s.id, s.order[1], 'C')
    const undone = await undoLastBaseline(db, s.id)
    expect(undone).toMatchObject({ ok: true, wordId: s.order[1] })
    expect((await getBaselineMap(db)).has(s.order[1])).toBe(false)
    expect(await listReviewItems(db)).toHaveLength(0)
    expect((await getSession(db, s.id))!.cursor).toBe(1)
    const log = await getSessionAttempts(db, s.id)
    expect(log.map((a) => !!a.revoked)).toEqual([false, true])
    await rate(db, s.id, s.order[1], 'B')
    expect((await getBaselineMap(db)).get(s.order[1])?.grade).toBe('B')
    expect((await undoLastBaseline(db, s.id)).ok).toBe(true)
    expect((await undoLastBaseline(db, s.id)).ok).toBe(true)
    expect(await undoLastBaseline(db, s.id)).toMatchObject({ ok: false })
  })

  it('已进入复习的词不能再撤销首评', async () => {
    const db = await setup()
    const s = await createSession(db, { wordlistId: BUILTIN_IDS.n3, mode: 'sample', sampleSize: 5, seed: 5 })
    await rate(db, s.id, s.order[0], 'C')
    await rateReview(db, { wordId: s.order[0], grade: 'C', revealMs: 1, durationMs: 1 })
    expect(await undoLastBaseline(db, s.id)).toMatchObject({ ok: false })
    expect((await getBaselineMap(db)).get(s.order[0])?.grade).toBe('C')
  })

  it('跳转落在指定位置之后最近的未评词上', async () => {
    const db = await setup()
    const s = await createSession(db, { wordlistId: BUILTIN_IDS.n3, mode: 'sample', sampleSize: 10, seed: 6 })
    expect((await jumpTo(db, s.id, 6)).cursor).toBe(5)
    await rate(db, s.id, s.order[5], 'A')
    expect((await jumpTo(db, s.id, 6)).cursor).toBe(6)
    await expect(jumpTo(db, s.id, 11)).rejects.toThrow('位置')
  })
})

describe('错词复习调度', () => {
  it('A 逐级推进到第 14 天后毕业，答错回到当天', async () => {
    const db = await setup()
    const s = await createSession(db, { wordlistId: BUILTIN_IDS.n3, mode: 'sample', sampleSize: 3, seed: 8 })
    const day0 = new Date(2026, 10, 16, 9, 0, 0)
    await rate(db, s.id, s.order[0], 'B', day0)
    const id = s.order[0]
    const step = async (grade: 'A' | 'B' | 'C', when: Date) => rateReview(db, { wordId: id, grade, revealMs: 1, durationMs: 1 }, when)
    expect(await step('A', day0)).toMatchObject({ stage: 1, dueDate: '2026-11-17' })
    expect(await step('A', new Date(2026, 10, 17))).toMatchObject({ stage: 2, dueDate: '2026-11-19' })
    expect(await step('C', new Date(2026, 10, 19))).toMatchObject({ stage: 0, dueDate: '2026-11-19', lapses: 1 })
    expect(await step('A', new Date(2026, 10, 19))).toMatchObject({ stage: 1, dueDate: '2026-11-20' })
    await step('A', new Date(2026, 10, 20))
    await step('A', new Date(2026, 10, 22))
    expect(await step('A', new Date(2026, 10, 29))).toMatchObject({ stage: 4, dueDate: '2026-12-06' })
    expect(await step('A', new Date(2026, 11, 6))).toMatchObject({ status: 'graduated' })
    expect(await dueItems(db, new Date(2027, 0, 1))).toHaveLength(0)
    expect((await getBaselineMap(db)).get(id)?.grade).toBe('B')
  })

  it('只有 B/C 进入队列，到期后才出现，撤销复习可还原', async () => {
    const db = await setup()
    const s = await createSession(db, { wordlistId: BUILTIN_IDS.n3, mode: 'sample', sampleSize: 3, seed: 8 })
    const now = new Date(2026, 10, 16, 9)
    await rate(db, s.id, s.order[0], 'A', now)
    await rate(db, s.id, s.order[1], 'B', now)
    expect((await dueItems(db, now)).map((i) => i.wordId)).toEqual([s.order[1]])
    await rateReview(db, { wordId: s.order[1], grade: 'A', revealMs: 1, durationMs: 1 }, now)
    expect(await dueItems(db, now)).toHaveLength(0)
    expect(await dueItems(db, new Date(2026, 10, 17))).toHaveLength(1)
    expect(await undoLastReview(db)).toMatchObject({ ok: true })
    expect(await dueItems(db, now)).toHaveLength(1)
    expect((await listReviewItems(db))[0]).toMatchObject({ stage: 0, reviewCount: 0 })
  })
})
