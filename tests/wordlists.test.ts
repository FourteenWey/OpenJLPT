import { describe, expect, it } from 'vitest'
import { ensureBuiltin, BUILTIN_IDS } from '../src/db/builtin'
import { getAllWords, getWordlist, importCustomList } from '../src/db/wordlists'
import { openDb } from '../src/db/db'
import { fsFetcher, freshDb, uniqueDbName } from './helpers'

describe('内置 OpenJLPT 词表', () => {
  it('N3-only 载入 1659 词，且重复载入不会产生第二份', async () => {
    const db = await freshDb()
    const first = await ensureBuiltin(db, 'n3', fsFetcher)
    expect(first.created).toBe(true)
    expect(first.list.scope).toBe('N3-only')
    expect(first.list.wordIds).toHaveLength(1659)
    expect(first.list.source.license).toBe('CC BY-SA 4.0')
    expect(first.list.source.attribution).toContain('OpenJLPT')
    const again = await ensureBuiltin(db, 'n3', fsFetcher)
    expect(again.created).toBe(false)
    expect(await getAllWords(db)).toHaveLength(1659)
  })

  it('N3-only 与 N5–N3 累计是两个独立词表，共享词条但不重复存储', async () => {
    const db = await freshDb()
    const n3 = await ensureBuiltin(db, 'n3', fsFetcher)
    const cum = await ensureBuiltin(db, 'cumulative', fsFetcher)
    expect(cum.list.scope).toBe('N5-N3-cumulative')
    expect(cum.list.wordIds).toHaveLength(2963)
    expect(cum.report?.linked).toBe(1659)
    expect(cum.report?.added).toBe(1304)
    const cumSet = new Set(cum.list.wordIds)
    expect(n3.list.wordIds.every((id) => cumSet.has(id))).toBe(true)
    expect(await getAllWords(db)).toHaveLength(2963)
    expect((await getWordlist(db, BUILTIN_IDS.n3))?.wordIds).toHaveLength(1659)
  })

  it('词条保留词形、读音、释义、词性与级别', async () => {
    const db = await freshDb()
    const { list } = await ensureBuiltin(db, 'n3', fsFetcher)
    const w = (await getAllWords(db)).find((x) => x.word === '挨拶')
    expect(w).toMatchObject({ reading: 'あいさつ', level: 'N3' })
    expect(w?.meanings).toContain('greeting')
    expect(w?.pos).toContain('vs')
    expect(list.wordIds).toContain(w?.id)
  })
})

describe('自定义词表导入与去重', () => {
  const csv = [
    'word,reading,meaning_zh,pos',
    '挨拶,あいさつ,问候,n; vs',
    '挨拶,あいさつ,重复行,n',
    '食べる,たべる,吃,v1',
    '新語,しんご,新词,n',
    ',みょう,缺词形,n',
    '漢字語,,缺读音,n',
  ].join('\n')

  it('按词形+读音与 OpenJLPT 词条去重，补充中文释义，并报告无效行', async () => {
    const db = await freshDb()
    await ensureBuiltin(db, 'n3', fsFetcher)
    const before = (await getAllWords(db)).length
    const { list, report } = await importCustomList(db, { name: '我的红宝书', frameType: 'complete', fileName: 'mine.csv', text: csv })
    expect(report).toMatchObject({ rows: 6, added: 2, duplicatesInFile: 1 })
    expect(report.invalid.map((i) => i.row)).toEqual([5, 6])
    expect(list.scope).toBe('custom')
    expect(list.wordIds).toHaveLength(report.linked + report.added)
    const words = await getAllWords(db)
    expect(words).toHaveLength(before + 2)
    expect(words.find((w) => w.word === '挨拶')?.meaningZh).toBe('问候')
    expect(words.find((w) => w.word === '新語')?.id).toMatch(/^u_[0-9a-f]{10}$/)
  })

  it('同一文件重复导入不会增加词条', async () => {
    const db = await freshDb()
    await importCustomList(db, { name: 'A', frameType: 'curated', fileName: 'a.csv', text: csv })
    const n = (await getAllWords(db)).length
    await importCustomList(db, { name: 'B', frameType: 'curated', fileName: 'a.csv', text: csv })
    expect(await getAllWords(db)).toHaveLength(n)
  })

  it('支持 JSON 导入并拒绝没有词形列的 CSV', async () => {
    const db = await freshDb()
    const json = JSON.stringify([{ word: '猫', reading: 'ねこ', meanings: ['cat'] }, { word: 'ねこ' }])
    const { report } = await importCustomList(db, { name: 'J', frameType: 'curated', fileName: 'x.json', text: json })
    expect(report.added).toBe(2)
    await expect(importCustomList(db, { name: 'X', frameType: 'curated', fileName: 'x.csv', text: 'a,b\n1,2' })).rejects.toThrow('表头')
  })

  it('关闭并重新打开数据库后词表仍在', async () => {
    const name = uniqueDbName()
    const db = await openDb(name)
    await ensureBuiltin(db, 'n3', fsFetcher)
    db.close()
    const reopened = await openDb(name)
    expect((await getWordlist(reopened, BUILTIN_IDS.n3))?.wordIds).toHaveLength(1659)
  })
})
