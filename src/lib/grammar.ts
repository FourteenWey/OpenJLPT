import catalog from '../data/jlpt-grammar.json'
import type { JlptLevel, StudyFrame } from '../types'

export const GRAMMAR_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const

export interface GrammarPoint {
  id: string
  level: JlptLevel
  pattern: string
  prompt: string
  questionCount: number
}

export const grammarSource = catalog.source
export const grammarPoints: GrammarPoint[] = GRAMMAR_LEVELS.flatMap((level) =>
  catalog.levels[level].entries.map((entry) => ({ ...entry, level, id: `${level}:${entry.pattern}` })),
)
export const grammarById = new Map(grammarPoints.map((point) => [point.id, point]))

export const grammarFrames: StudyFrame[] = GRAMMAR_LEVELS.map((level) => ({
  id: `jlpt-grammar-${level.toLowerCase()}`,
  name: `JLPT ${level} 语法`,
  scope: `${level}-only`,
  frameType: 'complete',
  wordIds: grammarPoints.filter((point) => point.level === level).map((point) => point.id),
}))
