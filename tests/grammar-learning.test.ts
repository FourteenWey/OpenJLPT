import { describe, expect, it } from 'vitest'
import type { Attempt } from '../src/types'
import { getAll, getSetting, openDb, req, run, STORE_KEYS } from '../src/db/db'
import { createSession } from '../src/db/sessions'
import { rateBaseline, undoLastBaseline } from '../src/db/rating'
import { dueItems, listReviewItems, rateReview, undoLastReview } from '../src/db/review'
import { dismissGrammarFeedback, getGrammarFeedback, rateGrammarReview } from '../src/db/grammarReview'
import { GRAMMAR_MIGRATION_KEY } from '../src/db/grammarMigration'
import { exportBackup, restoreBackup, validateBackup } from '../src/db/backup'
import { getAllAttempts } from '../src/db/queries'
import { grammarPoints } from '../src/lib/grammar'
import { getGrammarQuestion, grammarQuestions, QUIZ_BLANK } from '../src/lib/grammarQuiz'
import { grammarAnkiCsv, grammarAttemptsCsv, grammarLearning, grammarQuestionsCsv, grammarResultsCsv, summarizeGrammar } from '../src/lib/grammarLearning'
import { newReviewItem } from '../src/lib/schedule'
import { parseCsv } from '../src/lib/csv'
import { freshDb, uniqueDbName } from './helpers'

const day = (n = 18) => new Date(2026, 10, n, 9)
async function practice(db: IDBDatabase, correct = false, now = day()) {
  const session = await createSession(db, { subject: 'grammar', grammarQuiz: true, wordlistId: 'jlpt-grammar-n5', mode: 'sample', sampleSize: 1, seed: 42 }, now)
  const wordId = session.order[0]
  const q = getGrammarQuestion(wordId, session.seed)!
  const choice = correct ? q.answer : q.options.find((v) => v !== q.answer)!
  await rateBaseline(db, { sessionId: session.id, wordId, choice, durationMs: 100, revealMs: 100 }, now)
  return { session, wordId, q }
}

describe('语法错题与间隔复习', () => {
  it('错题独立去重，普通练习答对保留阶段，重犯重置；撤销还原队列', async () => {
    const db = await freshDb()
    const { wordId, q } = await practice(db)
    const [original] = await listReviewItems(db, 'grammar')
    expect(original).toMatchObject({ wordId, stage: 0, reviewCount: 0, dueDate: '2026-11-18' })
    expect(await listReviewItems(db)).toEqual([])
    await practice(db, true)
    expect(await listReviewItems(db, 'grammar')).toEqual([original])
    const review = await rateGrammarReview(db, { wordId, choice: q.answer, expectedReviewCount: 0, durationMs: 20 }, day())
    await dismissGrammarFeedback(db, review.id)
    const [advanced] = await listReviewItems(db, 'grammar')
    expect(advanced).toMatchObject({ stage: 1, reviewCount: 1, dueDate: '2026-11-19' })
    const repeated = await practice(db)
    expect(await listReviewItems(db, 'grammar')).toHaveLength(1)
    expect((await listReviewItems(db, 'grammar'))[0]).toMatchObject({ stage: 0, reviewCount: 1, lapses: 1 })
    expect((await undoLastBaseline(db, repeated.session.id)).ok).toBe(true)
    expect(await listReviewItems(db, 'grammar')).toEqual([advanced])
    const correct = await practice(db, true)
    expect((await undoLastBaseline(db, correct.session.id)).ok).toBe(true)
    expect(await listReviewItems(db, 'grammar')).toEqual([advanced])
  })

  it('到期逐级推进、毕业后再次犯错重新入队，不伪造复习次数', async () => {
    const db = await freshDb()
    const { wordId, q } = await practice(db)
    for (const [count, date] of [18, 19, 21, 25, 32].entries()) {
      const a = await rateGrammarReview(db, { wordId, choice: q.answer, expectedReviewCount: count, durationMs: 20 }, day(date))
      expect((await getGrammarFeedback(db))?.id).toBe(a.id)
      await dismissGrammarFeedback(db, a.id)
    }
    expect((await listReviewItems(db, 'grammar'))[0]).toMatchObject({ status: 'graduated', reviewCount: 5 })
    expect(await dueItems(db, day(40), 'grammar')).toEqual([])
    await practice(db, false, day(40))
    expect((await listReviewItems(db, 'grammar'))[0]).toMatchObject({ status: 'active', stage: 0, reviewCount: 5, dueDate: '2026-12-10' })
  })

  it('未到期不能作答，重复提交只记一次，解析持久化，撤销按科目隔离', async () => {
    const db = await freshDb()
    const { wordId, q } = await practice(db)
    await expect(rateGrammarReview(db, { wordId, choice: '无效选项', expectedReviewCount: 0, durationMs: 20 }, day())).rejects.toThrow('有效')
    const outcomes = await Promise.allSettled([0, 1].map(() => rateGrammarReview(db, { wordId, choice: q.answer, expectedReviewCount: 0, durationMs: 20 }, day())))
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const feedback = (await getGrammarFeedback(db))!
    await expect(rateGrammarReview(db, { wordId, choice: q.answer, expectedReviewCount: 1, durationMs: 20 }, day())).rejects.toThrow('继续当前')
    await run(db, ['reviewItems'], 'readwrite', async (tx) => { await req(tx.objectStore('reviewItems').put(newReviewItem('word-only', 'C', day()))) })
    await rateReview(db, { wordId: 'word-only', grade: 'A', revealMs: 1, durationMs: 1 }, day())
    expect((await undoLastReview(db)).ok).toBe(true)
    expect((await getGrammarFeedback(db))?.id).toBe(feedback.id)
    await dismissGrammarFeedback(db, feedback.id)
    await expect(rateGrammarReview(db, { wordId, choice: q.answer, expectedReviewCount: 1, durationMs: 20 }, day())).rejects.toThrow('进度')
    expect((await undoLastReview(db, 'grammar')).ok).toBe(true)
    expect(await getGrammarFeedback(db)).toBeUndefined()
    expect((await listReviewItems(db, 'grammar'))[0]).toMatchObject({ stage: 0, reviewCount: 0 })
    expect((await getAllAttempts(db, 'grammar')).filter((a) => a.kind === 'review' && !a.revoked)).toHaveLength(0)
  })

  it('有后续作答时拒绝撤销旧快筛和旧复习', async () => {
    const db = await freshDb()
    const { session, wordId, q } = await practice(db)
    const a = await rateGrammarReview(db, { wordId, choice: q.answer, expectedReviewCount: 0, durationMs: 20 }, day())
    await dismissGrammarFeedback(db, a.id)
    expect(await undoLastBaseline(db, session.id)).toMatchObject({ ok: false })
    await practice(db, true)
    expect(await undoLastReview(db, 'grammar')).toMatchObject({ ok: false })
    expect((await listReviewItems(db, 'grammar'))[0]).toMatchObject({ stage: 1 })
  })
})

describe('语法历史迁移和备份', () => {
  const id = grammarPoints[0].id
  const historical = (key: string, seq: number, over: Partial<Attempt> = {}): Attempt => ({
    id: key, seq, subject: 'grammar', kind: 'grammar-quiz', sessionId: 'old', wordId: id, grade: 'C',
    choice: 'old', answeredAt: day(1).toISOString(), durationMs: 20, revealMs: 20, ...over,
  })

  it('v2 数据库补入全部曾错题，忽略撤销和旧自评，快照可还原且重复打开不重置', async () => {
    const name = uniqueDbName()
    const request = indexedDB.open(name, 2)
    request.onupgradeneeded = () => {
      for (const [store, keyPath] of Object.entries(STORE_KEYS)) {
        if (store === 'grammarReviewItems') continue
        const os = request.result.createObjectStore(store, { keyPath })
        if (store === 'attempts') os.createIndex('bySession', 'sessionId')
      }
      const log = request.transaction!.objectStore('attempts')
      log.put(historical('wrong', 1))
      log.put(historical('correct-later', 2, { grade: 'A' }))
      log.put(historical('revoked', 3, { wordId: grammarPoints[1].id, revoked: true }))
      log.put(historical('self', 4, { wordId: grammarPoints[2].id, kind: 'baseline', grade: 'B' }))
    }
    const legacy = await req(request)
    legacy.close()
    let db = await openDb(name)
    const items = await listReviewItems(db, 'grammar')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ wordId: id, stage: 0, reviewCount: 0 })
    expect((await getAllAttempts(db, 'grammar')).find((a) => a.id === 'correct-later')?.prev).toEqual(items[0])
    expect(await getSetting(db, GRAMMAR_MIGRATION_KEY)).toMatchObject({ count: 1, noticePending: true })
    const saved = { ...items[0], stage: 3, dueDate: '2030-01-01' }
    await run(db, ['grammarReviewItems'], 'readwrite', async (tx) => { await req(tx.objectStore('grammarReviewItems').put(saved)) })
    db.close()
    db = await openDb(name)
    expect(await listReviewItems(db, 'grammar')).toEqual([saved])
    db.close()
  })

  it('v1/v2 恢复补入历史错误，v3/v4 恢复原样保留阶段和未离开的解析页', async () => {
    const db = await freshDb()
    const file = await exportBackup(db)
    file.data.attempts = [historical('wrong', 1), historical('right', 2, { grade: 'A' })]
    file.data.sessions = []
    for (const version of [1, 2]) {
      const target = await freshDb()
      const old = { ...file, version }
      expect(validateBackup(old).file.version).toBe(version)
      await restoreBackup(target, old)
      expect((await listReviewItems(target, 'grammar')).map((i) => i.wordId)).toEqual([id])
      expect(await getSetting(target, GRAMMAR_MIGRATION_KEY)).toMatchObject({ count: 1 })
      target.close()
    }
    const { wordId, q } = await practice(db)
    const a = await rateGrammarReview(db, { wordId, choice: q.answer, expectedReviewCount: 0, durationMs: 5 }, day())
    const backup = await exportBackup(db)
    const target = await freshDb()
    await restoreBackup(target, JSON.parse(JSON.stringify(backup)))
    expect(await listReviewItems(target, 'grammar')).toEqual(await listReviewItems(db, 'grammar'))
    expect((await getGrammarFeedback(target))?.id).toBe(a.id)
    expect(await getAll<Attempt>(target, 'attempts')).toEqual(await getAll(db, 'attempts'))
    const { bookmarks: _, ...oldData } = backup.data
    await restoreBackup(target, { ...backup, version: 3, data: oldData })
    expect(await listReviewItems(target, 'grammar')).toEqual(await listReviewItems(db, 'grammar'))
    expect((await getGrammarFeedback(target))?.id).toBe(a.id)
    const broken = { ...backup, data: { ...backup.data, grammarReviewItems: undefined } }
    await expect(restoreBackup(target, broken)).rejects.toThrow('grammarReviewItems')
    expect((await getGrammarFeedback(target))?.id).toBe(a.id)
  })
})

describe('语法统计及导出', () => {
  it('按语法点计算覆盖和首答，练习按次数，复习、自评、撤销及单词不混入', () => {
    const points = grammarPoints.slice(0, 2)
    const base: Attempt = { id: 'a', seq: 1, kind: 'grammar-quiz', subject: 'grammar', sessionId: 's', wordId: points[0].id, grade: 'C', answeredAt: '', revealMs: 1, durationMs: 1 }
    const attempts = [base, { ...base, id: 'b', seq: 2, grade: 'A' as const },
      { ...base, id: 'c', seq: 3, grade: 'A' as const, wordId: points[1].id },
      { ...base, id: 'd', seq: 4, kind: 'review' as const, grade: 'A' as const },
      { ...base, id: 'e', seq: 5, revoked: true }, { ...base, id: 'f', kind: 'baseline' as const },
      { ...base, id: 'g', subject: 'vocabulary' as const }]
    expect(summarizeGrammar(attempts, points)).toMatchObject({ covered: 2, total: 2, coverage: 1, answered: 3, correct: 2, firstAccuracy: 0.5 })
    expect(summarizeGrammar(attempts, points).accuracy).toBeCloseTo(2 / 3)
    expect(grammarLearning(attempts).errors.get(points[0].id)).toBe(1)
    expect(grammarLearning(attempts).latest.get(points[0].id)?.kind).toBe('review')
  })

  it('题库、日志、结果 CSV 可解析，Anki 使用稳定独立 GUID 并包含正确句和解析', () => {
    const points = grammarPoints.slice(0, 2)
    const csv = parseCsv(grammarQuestionsCsv(points))
    expect(csv).toHaveLength(3)
    expect(csv.every((r) => r.length === csv[0].length)).toBe(true)
    const q = grammarQuestions.get(points[0].id)!
    const anki = grammarAnkiCsv(points)
    expect(anki).toContain(`grammar:${points[0].id}`)
    expect(anki).toContain(q.prompt.replace(QUIZ_BLANK, q.answer))
    expect(anki).toContain(q.explanation)
    expect(parseCsv(grammarResultsCsv(points, [], []))).toHaveLength(3)
    expect(parseCsv(grammarAttemptsCsv([]))).toHaveLength(1)
  })
})
