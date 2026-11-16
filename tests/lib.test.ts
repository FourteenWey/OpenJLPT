import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fnv1a, drawSample, frameHash, parseSeed, seededShuffle } from '../src/lib/rng'
import { parseCsv, toCsv } from '../src/lib/csv'
import { breakdown, median, summarizeBaseline, summarizeRetention, wilson } from '../src/lib/stats'
import { isCompoundVerb, posClass, scriptClass } from '../src/lib/classify'
import { addDays, applyReview, newReviewItem } from '../src/lib/schedule'
import { ankiCsv } from '../src/lib/exports'
import type { Attempt, Baseline, Session, Word } from '../src/types'

const n3 = JSON.parse(readFileSync('public/data/openjlpt-n3.json', 'utf8')).entries as Word[]

describe('随机抽样', () => {
  const ids = Array.from({ length: 200 }, (_, i) => `id${i}`)
  it('与存储顺序无关、可复现、无重复', () => {
    const a = drawSample(ids, 50, 123)
    expect(drawSample([...ids].reverse(), 50, 123)).toEqual(a)
    expect(new Set(a).size).toBe(50)
    expect(drawSample(ids, 50, 124)).not.toEqual(a)
    expect(frameHash(ids)).toBe(frameHash([...ids].reverse()))
    expect(seededShuffle(ids, 1)).toHaveLength(200)
  })
  it('种子可以是数字或任意文本', () => {
    expect(parseSeed('2026')).toBe(2026)
    expect(parseSeed('hello')).toBe(parseInt(fnv1a('hello'), 16))
    expect(parseSeed('  ')).toBeNull()
  })
})

describe('CSV', () => {
  it('处理引号、逗号、换行、BOM 与 CRLF', () => {
    const rows = [['a,b', 'he said "hi"', 'line1\nline2'], ['x', '', 'y']]
    expect(parseCsv('\ufeff' + toCsv(rows))).toEqual(rows)
    expect(parseCsv('a,b\r\n1,2\r\n\r\n')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('导出时防止公式注入', () => {
    expect(toCsv([['=1+1', '-x', 'ok']], { guardFormulas: true })).toBe("'=1+1,'-x,ok\r\n")
  })
})

describe('Wilson 置信区间', () => {
  it('与已知值一致', () => {
    const ci = wilson(50, 100)!
    expect(ci.low).toBeCloseTo(0.4038, 3)
    expect(ci.high).toBeCloseTo(0.5962, 3)
    expect(wilson(0, 10)!.high).toBeCloseTo(0.2775, 3)
    expect(wilson(0, 0)).toBeNull()
  })
  it('有限总体校正：区间变窄，全量时退化为点', () => {
    const plain = wilson(300, 400)!
    const fpc = wilson(300, 400, 1.959964, 1659)!
    expect(fpc.high - fpc.low).toBeLessThan(plain.high - plain.low)
    expect(wilson(300, 400, 1.959964, 1e9)!.low).toBeCloseTo(plain.low, 4)
    expect(wilson(30, 40, 1.959964, 40)).toEqual({ low: 0.75, high: 0.75 })
  })
  it('median', () => expect([median([3, 1, 2]), median([4, 1, 2, 3]), median([])]).toEqual([2, 2.5, 0]))
})

function session(over: Partial<Session>): Session {
  return {
    id: 's', mode: 'sample', wordlistId: 'l', wordlistName: 'L', scope: 'N3-only', frameType: 'complete', frameSize: 100, frameHash: 'x',
    seed: 1, sampleSize: 4, order: ['a', 'b', 'c', 'd'], preRated: 0, drawnAt: '', createdAt: '', updatedAt: '', cursor: 0, status: 'active', activeMs: 0,
    ...over,
  }
}
const base = (wordId: string, grade: 'A' | 'B' | 'C', sessionId = 's', durationMs = 1000): Baseline => ({
  wordId, grade, attemptId: wordId, sessionId, wordlistId: 'l', ratedAt: '', durationMs,
})

describe('基线统计的推断口径', () => {
  const full = new Map([base('a', 'A'), base('b', 'A', 's', 3000), base('c', 'B'), base('d', 'C')].map((b) => [b.wordId, b]))
  it('完整框的随机样本答完后才给置信区间', () => {
    const s = summarizeBaseline(session({}), full)
    expect(s).toMatchObject({ inference: 'ci', rated: 4, counts: { A: 2, B: 1, C: 1 } })
    expect(s.ciA).not.toBeNull()
    expect(s.timing).toMatchObject({ answered: 4, medianMs: 1000, meanMs: 1500 })
    const partial = summarizeBaseline(session({}), new Map([...full].slice(0, 2)))
    expect(partial).toMatchObject({ inference: 'none', ciA: null, completion: 0.5 })
  })
  it('人工挑选的词表不声称总体估计精度', () => {
    const s = summarizeBaseline(session({ frameType: 'curated' }), full)
    expect(s.inference).toBe('none')
    expect(s.ciA).toBeNull()
    expect(s.inferenceNote).toContain('不推断总体')
  })
  it('全量普查没有抽样误差，未完成则不推断', () => {
    expect(summarizeBaseline(session({ mode: 'census', frameSize: 4 }), full)).toMatchObject({ inference: 'census', ciA: null })
    expect(summarizeBaseline(session({ mode: 'census', sampleSize: 5, order: ['a', 'b', 'c', 'd', 'e'] }), full).inference).toBe('none')
  })
  it('只统计本会话作答的耗时，沿用的首评不计入', () => {
    const m = new Map([base('a', 'A', 'other', 9999), base('b', 'A')].map((b) => [b.wordId, b]))
    expect(summarizeBaseline(session({}), m).timing.answered).toBe(1)
  })
})

describe('维度分类（真实 N3 数据）', () => {
  it('词性大类互斥且合计等于总数', () => {
    const counts = new Map<string, number>()
    for (const w of n3) counts.set(posClass(w), (counts.get(posClass(w)) ?? 0) + 1)
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(1659)
    expect(posClass({ pos: ['n', 'vs', 'vi'] })).toBe('する名词')
    expect(posClass({ pos: ['n', 'adj-no'] })).toBe('名词')
    expect(posClass({ pos: ['v5r', 'vt'] })).toBe('动词')
    expect(posClass({ pos: [] })).toBe('未标注')
  })
  it('假名词与汉字词', () => {
    expect(scriptClass({ word: 'ありがとう' })).toBe('假名词')
    expect(scriptClass({ word: 'コンビニ' })).toBe('假名词')
    expect(scriptClass({ word: 'お祝い' })).toBe('汉字词')
    expect(n3.filter((w) => scriptClass(w) === '假名词')).toHaveLength(218)
  })
  it('复合动词启发式', () => {
    const compound = n3.filter(isCompoundVerb).map((w) => w.word)
    for (const w of ['受け取る', '話し合う', '申し込む', '飛び出す', '似合う']) expect(compound).toContain(w)
    for (const w of ['気に入る', '引っ張る', '気付く', '裏切る']) expect(compound).not.toContain(w)
  })
  it('breakdown 只统计已有首评的词，compound 只含动词', () => {
    const words = [{ id: 'a', word: '食べる', reading: 'たべる', meanings: [], pos: ['v1'] }, { id: 'b', word: '猫', reading: 'ねこ', meanings: [], pos: ['n'] }]
    const rows = breakdown('compound', words, new Map([base('a', 'A'), base('b', 'C')].map((b) => [b.wordId, b])))
    expect(rows).toEqual([{ label: '其他动词', n: 1, counts: { A: 1, B: 0, C: 0 }, rateA: 1 }])
  })
})

describe('复习调度与保持率', () => {
  it('addDays 跨月与跨年', () => expect([addDays('2026-11-30', 1), addDays('2026-12-31', 14)]).toEqual(['2026-12-01', '2027-01-14']))
  it('新项目从当天开始；B 答错回到阶段 0', () => {
    const item = newReviewItem('w', 'C', new Date(2026, 10, 16))
    expect(item).toMatchObject({ stage: 0, dueDate: '2026-11-16' })
    const up = applyReview(item, 'A', new Date(2026, 10, 16))
    expect(applyReview(up, 'B', new Date(2026, 10, 17))).toMatchObject({ stage: 0, lapses: 1, dueDate: '2026-11-17' })
  })
  it('保持率只统计复习作答，忽略已撤销', () => {
    const a = (grade: 'A' | 'C', stage: number, revoked = false): Attempt => ({
      id: String(Math.random()), seq: 1, kind: 'review', sessionId: 'review', wordId: 'w', grade, stage, answeredAt: '', revealMs: 0, durationMs: 0, revoked,
    })
    const r = summarizeRetention([a('A', 0), a('C', 0), a('A', 1), a('A', 1, true), { ...a('A', 0), kind: 'baseline' }])
    expect(r).toMatchObject({ total: 3, passed: 2 })
    expect(r.byStage).toEqual([{ stage: 0, n: 2, passed: 1, rate: 0.5 }, { stage: 1, n: 1, passed: 1, rate: 1 }])
  })
})

describe('Anki 导出', () => {
  it('包含文件头、GUID 列并转义 HTML', () => {
    const w: Word = { id: 'abc', word: '<猫>', reading: 'ねこ', meanings: ['cat', 'tom'], meaningZh: '猫', pos: ['n'] }
    const out = ankiCsv([{ word: w, first: 'C', latest: 'C' }], 'N3-only')
    expect(out.split('\r\n').slice(0, 6)).toEqual(['#separator:Comma', '#html:true', '#notetype:Basic', '#deck:JLPT 错词', '#guid column:1', '#tags column:4'])
    expect(out).toContain('abc,&lt;猫&gt;,ねこ<br>猫 / cat; tom<br>n,jlpt-vocab-scanner N3-only first-C')
  })
})
