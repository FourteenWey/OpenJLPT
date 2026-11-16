import { describe, expect, it } from 'vitest'
import { BACKUP_FORMAT, exportBackup, restoreBackup, validateBackup } from '../src/db/backup'
import { BUILTIN_IDS, ensureBuiltin } from '../src/db/builtin'
import { getAllAttempts, getBaselineMap } from '../src/db/queries'
import { rateBaseline } from '../src/db/rating'
import { listReviewItems, rateReview } from '../src/db/review'
import { createSession, listSessions } from '../src/db/sessions'
import { getAllWords, listWordlists } from '../src/db/wordlists'
import { fsFetcher, freshDb } from './helpers'

describe('JSON 备份与恢复', () => {
  async function populated() {
    const db = await freshDb()
    await ensureBuiltin(db, 'n3', fsFetcher)
    const s = await createSession(db, { wordlistId: BUILTIN_IDS.n3, mode: 'sample', sampleSize: 4, seed: 21 })
    for (const [i, g] of (['A', 'B', 'C'] as const).entries()) {
      await rateBaseline(db, { sessionId: s.id, wordId: s.order[i], grade: g, revealMs: 10, durationMs: 20 })
    }
    await rateReview(db, { wordId: s.order[1], grade: 'A', revealMs: 5, durationMs: 6 })
    return { db, s }
  }

  it('导出后在全新数据库中恢复，各表内容一致', async () => {
    const { db, s } = await populated()
    const file = JSON.parse(JSON.stringify(await exportBackup(db)))
    expect(file.format).toBe(BACKUP_FORMAT)

    const target = await freshDb()
    const counts = await restoreBackup(target, file)
    expect(counts).toMatchObject({ wordlists: 1, words: 1659, sessions: 1, baselines: 3, reviewItems: 2 })
    expect([...(await getBaselineMap(target))]).toEqual([...(await getBaselineMap(db))])
    expect(await listSessions(target)).toEqual(await listSessions(db))
    expect(await listReviewItems(target)).toEqual(await listReviewItems(db))
    expect(await getAllAttempts(target)).toHaveLength((await getAllAttempts(db)).length)
    expect(await listWordlists(target)).toEqual(await listWordlists(db))
    expect((await listSessions(target))[0].id).toBe(s.id)
  })

  it('恢复会整体替换现有数据', async () => {
    const { db } = await populated()
    const file = await exportBackup(db)
    const other = await freshDb()
    await ensureBuiltin(other, 'cumulative', fsFetcher)
    await restoreBackup(other, file)
    expect(await getAllWords(other)).toHaveLength(1659)
    expect((await listWordlists(other)).map((l) => l.id)).toEqual([BUILTIN_IDS.n3])
  })

  it('结构非法的备份被拒绝，且不会清空现有数据', async () => {
    const { db } = await populated()
    const file = await exportBackup(db)
    const broken = JSON.parse(JSON.stringify(file))
    delete broken.data.attempts
    expect(() => validateBackup(broken)).toThrow('attempts')
    await expect(restoreBackup(db, broken)).rejects.toThrow('attempts')
    await expect(restoreBackup(db, { format: 'other' })).rejects.toThrow('备份文件')
    await expect(restoreBackup(db, { ...file, version: 99 })).rejects.toThrow('版本')
    const noKey = JSON.parse(JSON.stringify(file))
    noKey.data.baselines[0] = { grade: 'A' }
    await expect(restoreBackup(db, noKey)).rejects.toThrow('主键')
    expect((await getBaselineMap(db)).size).toBe(3)
  })
})
