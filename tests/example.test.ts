import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUILTIN_IDS, ensureBuiltin, refreshBuiltinWords, type JsonFetcher } from '../src/db/builtin'
import { getSetting, putSetting } from '../src/db/db'
import { createSession } from '../src/db/sessions'
import { getAllWords, importCustomList, putWords } from '../src/db/wordlists'
import { splitAtWord } from '../src/lib/example'
import type { Word } from '../src/types'
import { fsFetcher, freshDb } from './helpers'

const level = (l: string) => JSON.parse(readFileSync(`public/data/openjlpt-${l}.json`, 'utf8')).entries as Word[]
const n3 = level('n3')

/** 模拟老版本数据：词表文件里没有例句。 */
const withoutExamples: JsonFetcher = async (url) => {
  const data = (await fsFetcher(url)) as { entries?: Word[] }
  return data.entries ? { ...data, entries: data.entries.map(({ example: _drop, ...w }) => w) } : data
}

describe('例句高亮', () => {
  it('标出独立出现的目标词', () => {
    expect(splitAtWord('よく考えた末、私は家にいることに決めた。', { word: '末' })).toEqual(['よく考えた', '末', '、私は家にいることに決めた。'])
  })
  it('单个汉字的词不会匹配到复合词内部', () => {
    expect(splitAtWord('週末は忙しい。', { word: '末' })).toBeNull()
    expect(splitAtWord('月末と末っ子', { word: '末' })?.[0]).toBe('月末と')
  })
  it('活用后用词干高亮，找不到时返回 null', () => {
    expect(splitAtWord('彼は本を読んでいる。', { word: '読む' })).toEqual(['彼は本を', '読', 'んでいる。'])
    expect(splitAtWord('食べ物を食べる。', { word: '食べる' })).toEqual(['食べ物を', '食べる', '。'])
    expect(splitAtWord('今日は晴れです。', { word: '明日' })).toBeNull()
  })
})

describe('内置例句数据', () => {
  it('N3 绝大多数词带例句，且不含注音标记', () => {
    const withEx = n3.filter((w) => w.example)
    expect(withEx.length).toBeGreaterThan(1600)
    expect(withEx.every((w) => w.example!.ja && w.example!.translation && !/[{}|]/.test(w.example!.ja))).toBe(true)
  })
  it('同词形多读音的词不带无法确认读音的例句（今日 こんにち 的句子读 きょう）', () => {
    const konnichi = n3.find((w) => w.word === '今日' && w.reading === 'こんにち')
    expect(konnichi?.example).toBeUndefined()
    expect(n3.find((w) => w.word === '末')?.example?.ja).toContain('末')
  })
})

describe('例句迁移与导入', () => {
  it('老数据库启动时一次性补上例句，只运行一次，不覆盖已有例句', async () => {
    const db = await freshDb()
    await ensureBuiltin(db, 'n3', withoutExamples)
    expect((await getAllWords(db)).some((w) => w.example)).toBe(false)

    const keep = (await getAllWords(db))[0]
    await putWords(db, [{ ...keep, example: { ja: '自分で加えた例句。' } }])

    expect(await refreshBuiltinWords(db, fsFetcher)).toBeGreaterThan(1500)
    const words = await getAllWords(db)
    expect(words.find((w) => w.id === keep.id)?.example?.ja).toBe('自分で加えた例句。')
    expect(words.filter((w) => w.example).length).toBeGreaterThan(1600)
    expect(await getSetting(db, 'builtinDataRev')).toBe(2)
    expect(await refreshBuiltinWords(db, fsFetcher)).toBe(0)
  })

  it('还没载入内置词表时不做任何事', async () => {
    const db = await freshDb()
    expect(await refreshBuiltinWords(db, fsFetcher)).toBe(0)
    expect(await getSetting(db, 'builtinDataRev')).toBeUndefined()
    await putSetting(db, 'x', 1)
  })

  it('自定义词表可带 example / example_translation 列，并补到已有词条上', async () => {
    const db = await freshDb()
    await ensureBuiltin(db, 'n3', withoutExamples)
    const csv = 'word,reading,example,example_translation\n末,すえ,考えた末に決めた。,想了很久才决定。\n新語,しんご,新語を覚える。,'
    await importCustomList(db, { name: '我的', frameType: 'curated', fileName: 'e.csv', text: csv })
    const words = await getAllWords(db)
    expect(words.find((w) => w.word === '末')?.example).toEqual({ ja: '考えた末に決めた。', translation: '想了很久才决定。' })
    expect(words.find((w) => w.word === '新語')?.example).toEqual({ ja: '新語を覚える。' })
  })

  it('会话记录是否开启例句提示，默认只显示词形', async () => {
    const db = await freshDb()
    await ensureBuiltin(db, 'n3', fsFetcher)
    const a = await createSession(db, { wordlistId: BUILTIN_IDS.n3, mode: 'sample', sampleSize: 3, seed: 1, hint: 'example' })
    const b = await createSession(db, { wordlistId: BUILTIN_IDS.n3, mode: 'sample', sampleSize: 3, seed: 1 })
    expect([a.hint, b.hint]).toEqual(['example', 'none'])
    expect(a.order).toEqual(b.order)
  })
})
