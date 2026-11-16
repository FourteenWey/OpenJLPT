import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ensureBuiltin } from '../src/db/builtin'
import { getAllWords, importCustomList } from '../src/db/wordlists'
import { applyGeneratedZh } from '../src/db/zh'
import { zhGloss } from '../src/lib/gloss'
import { fsFetcher, freshDb } from './helpers'
import type { JsonFetcher } from '../src/db/builtin'

const n3 = JSON.parse(readFileSync('public/data/openjlpt-n3.json', 'utf8')).entries as { id: string; word: string; reading: string }[]

const fakeZh = (entries: Record<string, string>, uncertain: string[] = []): JsonFetcher => async (url) =>
  url.endsWith('openjlpt-n3-zh.json') ? { entries, uncertain } : fsFetcher(url)

describe('生成的中文释义', () => {
  it('载入内置词表时按 ID 合并，并标记待核对的词', async () => {
    const db = await freshDb()
    const [a, b, c] = n3
    await ensureBuiltin(db, 'n3', fakeZh({ [a.id]: '爱', [b.id]: '问候', [c.id]: '爱情' }, [b.id]))
    const words = new Map((await getAllWords(db)).map((w) => [w.id, w]))
    expect(words.get(a.id)).toMatchObject({ meaningZhGen: '爱' })
    expect(words.get(a.id)?.zhGenCheck).toBeUndefined()
    expect(words.get(b.id)).toMatchObject({ meaningZhGen: '问候', zhGenCheck: true })
    expect(words.get(n3[10].id)?.meaningZhGen).toBeUndefined()
  })

  it('重复应用是幂等的，更新后的内容会覆盖旧的生成释义', async () => {
    const db = await freshDb()
    await ensureBuiltin(db, 'n3', fsFetcher)
    const id = n3[0].id
    expect(await applyGeneratedZh(db, fakeZh({ [id]: '甲' }))).toBe(1)
    expect(await applyGeneratedZh(db, fakeZh({ [id]: '甲' }))).toBe(0)
    expect(await applyGeneratedZh(db, fakeZh({ [id]: '乙' }, [id]))).toBe(1)
    const w = (await getAllWords(db)).find((x) => x.id === id)
    expect(w).toMatchObject({ meaningZhGen: '乙', zhGenCheck: true })
  })

  it('不会改动用户导入的 meaningZh；显示时用户的优先', async () => {
    const db = await freshDb()
    await ensureBuiltin(db, 'n3', fsFetcher)
    const { word, reading, id } = n3[0]
    await importCustomList(db, { name: '我的', frameType: 'curated', fileName: 'a.csv', text: `word,reading,meaning_zh\n${word},${reading},红宝书释义` })
    await applyGeneratedZh(db, fakeZh({ [id]: '生成释义' }))
    const w = (await getAllWords(db)).find((x) => x.id === id)!
    expect(w).toMatchObject({ meaningZh: '红宝书释义', meaningZhGen: '生成释义' })
    expect(zhGloss(w)).toEqual({ text: '红宝书释义', generated: false, check: false })
    expect(zhGloss({ meaningZhGen: 'x', zhGenCheck: true })).toEqual({ text: 'x', generated: true, check: true })
    expect(zhGloss({})).toBeNull()
  })

  it('词表文件缺失或损坏时静默跳过', async () => {
    const db = await freshDb()
    await ensureBuiltin(db, 'n3', fsFetcher)
    expect(await applyGeneratedZh(db, async () => { throw new Error('404') })).toBe(0)
    expect(await applyGeneratedZh(db, async () => ({ nope: 1 }))).toBe(0)
  })
})

describe('随项目提供的 N3 中文释义文件', () => {
  const file = JSON.parse(readFileSync('public/data/openjlpt-n3-zh.json', 'utf8')) as { entries: Record<string, string>; uncertain: string[]; count: number }
  it('覆盖全部 1659 个 N3 词，且每条都含汉字', () => {
    expect(file.count).toBe(1659)
    expect(n3.every((w) => typeof file.entries[w.id] === 'string')).toBe(true)
    expect(Object.keys(file.entries)).toHaveLength(1659)
    const bad = n3.filter((w) => !/[\u3400-\u9fff]/.test(file.entries[w.id]))
    expect(bad.map((w) => `${w.word}:${file.entries[w.id]}`)).toEqual([])
  })
  it('待核对列表里的 ID 都是 N3 词', () => {
    const ids = new Set(n3.map((w) => w.id))
    expect(file.uncertain.every((id) => ids.has(id))).toBe(true)
  })
})
