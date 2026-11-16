// CSV 导出：Anki 错词、首评/最近评级结果表、作答日志。
import type { Attempt, Baseline, Grade, ReviewItem, Word } from '../types'
import { GRADE_LABEL } from '../types'
import { toCsv } from './csv'
import { zhGloss } from './gloss'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function meaningText(w: Word): string {
  return [zhGloss(w)?.text, w.meanings.join('; ')].filter(Boolean).join(' / ')
}

export interface WrongWord {
  word: Word
  first: Grade
  latest: Grade
}

/**
 * Anki 2.1.54+ 的文本导入：文件头指定分隔符、HTML、笔记类型与 GUID 列。
 * 第 1 列为词 ID（重复导入时更新而不是新增），第 2/3 列为正面/背面，第 4 列为标签。
 */
export function ankiCsv(items: WrongWord[], scopeLabel: string, deck = 'JLPT 错词'): string {
  const head = ['#separator:Comma', '#html:true', '#notetype:Basic', `#deck:${deck}`, '#guid column:1', '#tags column:4']
  const rows = items.map(({ word: w, first }) => {
    const back = [esc(w.reading), esc(meaningText(w)), esc(w.pos.join(' '))].filter(Boolean).join('<br>')
    return [w.id, esc(w.word), back, `jlpt-vocab-scanner ${scopeLabel} first-${first}`]
  })
  return head.join('\r\n') + '\r\n' + toCsv(rows)
}

export interface ResultRow {
  word: Word
  baseline?: Baseline
  review?: ReviewItem
}

export function resultsCsv(rows: ResultRow[], scopeLabel: string): string {
  const header = [
    'id', 'word', 'reading', 'meaning_zh', 'meaning_zh_generated', 'meanings_en', 'pos', 'level', 'scope',
    'first_grade', 'first_rated_at', 'first_duration_ms', 'latest_grade', 'review_stage', 'review_due', 'review_status', 'lapses',
  ]
  const body = rows.map(({ word: w, baseline: b, review: r }) => [
    w.id, w.word, w.reading, w.meaningZh, w.meaningZhGen, w.meanings.join('; '), w.pos.join('; '), w.level, scopeLabel,
    b?.grade, b?.ratedAt, b?.durationMs, r?.lastGrade ?? b?.grade, r?.stage, r?.dueDate, r?.status, r?.lapses,
  ])
  return toCsv([header, ...body], { guardFormulas: true })
}

export function attemptsCsv(attempts: Attempt[], words: Map<string, Word>): string {
  const header = ['answered_at', 'kind', 'session_id', 'word_id', 'word', 'reading', 'grade', 'grade_label', 'stage', 'reveal_ms', 'duration_ms', 'revoked']
  const body = [...attempts]
    .sort((a, b) => a.seq - b.seq)
    .map((a) => {
      const w = words.get(a.wordId)
      return [a.answeredAt, a.kind, a.sessionId, a.wordId, w?.word, w?.reading, a.grade, GRADE_LABEL[a.grade], a.stage, a.revealMs, a.durationMs, a.revoked ? 'yes' : '']
    })
  return toCsv([header, ...body], { guardFormulas: true })
}
