// 统计：A/B/C 计数、Wilson 置信区间、耗时、维度拆分、复习保持率。
import type { Attempt, Baseline, Grade, Session, Word } from '../types'
import { isCompoundVerb, isVerb, posClass, scriptClass } from './classify'

export const Z95 = 1.959964

export interface Interval {
  low: number
  high: number
}

/**
 * Wilson 得分区间。给出总体大小 population 时按无放回抽样做有限总体校正：
 * 等效样本量 n·(N-1)/(N-n)；n ≥ N（全量）时区间退化为单点。
 */
export function wilson(successes: number, n: number, z = Z95, population?: number): Interval | null {
  if (n <= 0) return null
  const p = successes / n
  if (population !== undefined && n >= population) return { low: p, high: p }
  const ne = population !== undefined && population > 1 ? (n * (population - 1)) / (population - n) : n
  const z2 = z * z
  const denom = 1 + z2 / ne
  const center = (p + z2 / (2 * ne)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / ne + z2 / (4 * ne * ne))) / denom
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) }
}

export type GradeCounts = Record<Grade, number>
export const emptyCounts = (): GradeCounts => ({ A: 0, B: 0, C: 0 })
export const sumCounts = (c: GradeCounts) => c.A + c.B + c.C

export function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export type Inference = 'ci' | 'census' | 'none'

export interface BaselineSummary {
  frameSize: number
  sampleSize: number
  rated: number
  completion: number
  counts: GradeCounts
  /** 以已答词为分母的 A/B/C 占比 */
  rates: GradeCounts
  inference: Inference
  inferenceNote: string
  ciA: Interval | null
  ciC: Interval | null
  timing: { answered: number; totalMs: number; meanMs: number; medianMs: number; sessionActiveMs: number }
}

export function summarizeBaseline(session: Session, baselines: Map<string, Baseline>): BaselineSummary {
  const counts = emptyCounts()
  const durations: number[] = []
  for (const id of session.order) {
    const b = baselines.get(id)
    if (!b) continue
    counts[b.grade]++
    if (b.sessionId === session.id) durations.push(b.durationMs)
  }
  const rated = sumCounts(counts)
  const pct = (n: number) => (rated ? n / rated : 0)
  const complete = rated === session.sampleSize
  let inference: Inference = 'none'
  let note = ''
  const grammar = session.subject === 'grammar'
  const frameLabel = grammar ? '语法库' : '词表'
  const unit = grammar ? '个语法点' : '词'
  if (session.mode === 'census') {
    inference = complete ? 'census' : 'none'
    note = complete
      ? `全量普查：结果就是该${frameLabel}的实际比例，没有抽样误差。`
      : `普查尚未完成，比例只代表已答的${grammar ? '语法点' : '词'}，不作总体估计。`
  } else if (session.frameType === 'curated') {
    note = `样本框是人工挑选的${frameLabel}，结果只描述这些${grammar ? '语法点' : '词'}，不推断总体掌握率。`
  } else if (!complete) {
    note = '随机样本尚未答完，暂不给出总体估计。'
  } else {
    inference = 'ci'
    note = `随机样本（种子 ${session.seed}，无放回，n=${session.sampleSize}，样本框 ${session.frameSize} ${unit}）；区间为 95% Wilson，已做有限总体校正，只适用于该样本框。`
  }
  const ci = inference === 'ci'
  const total = durations.reduce((s, d) => s + d, 0)
  return {
    frameSize: session.frameSize,
    sampleSize: session.sampleSize,
    rated,
    completion: session.sampleSize ? rated / session.sampleSize : 0,
    counts,
    rates: { A: pct(counts.A), B: pct(counts.B), C: pct(counts.C) },
    inference,
    inferenceNote: note,
    ciA: ci ? wilson(counts.A, rated, Z95, session.frameSize) : null,
    ciC: ci ? wilson(counts.C, rated, Z95, session.frameSize) : null,
    timing: {
      answered: durations.length,
      totalMs: total,
      meanMs: durations.length ? total / durations.length : 0,
      medianMs: median(durations),
      sessionActiveMs: session.activeMs,
    },
  }
}

export type Dimension = 'pos' | 'script' | 'compound' | 'level'
export interface DimRow {
  label: string
  n: number
  counts: GradeCounts
  rateA: number
}

function labelOf(dim: Dimension, w: Word): string | null {
  if (dim === 'pos') return posClass(w)
  if (dim === 'script') return scriptClass(w)
  if (dim === 'level') return w.level ?? '未标注'
  return isVerb(w) ? (isCompoundVerb(w) ? '复合动词' : '其他动词') : null
}

/** 只统计已有首评的词；compound 维度只包含动词。 */
export function breakdown(dim: Dimension, words: Word[], baselines: Map<string, Baseline>): DimRow[] {
  const rows = new Map<string, GradeCounts>()
  for (const w of words) {
    const b = baselines.get(w.id)
    const label = labelOf(dim, w)
    if (!b || !label) continue
    const c = rows.get(label) ?? emptyCounts()
    c[b.grade]++
    rows.set(label, c)
  }
  return [...rows.entries()]
    .map(([label, counts]) => ({ label, counts, n: sumCounts(counts), rateA: counts.A / sumCounts(counts) }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
}

export interface RetentionSummary {
  total: number
  passed: number
  rate: number | null
  wordsReviewed: number
  byStage: { stage: number; n: number; passed: number; rate: number | null }[]
}

/** 复习后的记忆保持率：只看复习作答，与首次基线的独立识词覆盖率分开。 */
export function summarizeRetention(attempts: Attempt[]): RetentionSummary {
  const reviews = attempts.filter((a) => a.kind === 'review' && !a.revoked)
  const stages = new Map<number, { n: number; passed: number }>()
  for (const a of reviews) {
    const s = stages.get(a.stage ?? 0) ?? { n: 0, passed: 0 }
    s.n++
    if (a.grade === 'A') s.passed++
    stages.set(a.stage ?? 0, s)
  }
  const passed = reviews.filter((a) => a.grade === 'A').length
  return {
    total: reviews.length,
    passed,
    rate: reviews.length ? passed / reviews.length : null,
    wordsReviewed: new Set(reviews.map((a) => a.wordId)).size,
    byStage: [...stages.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([stage, s]) => ({ stage, ...s, rate: s.n ? s.passed / s.n : null })),
  }
}
