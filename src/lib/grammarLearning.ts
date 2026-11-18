import type { Attempt, ReviewItem } from '../types'
import { grammarById, grammarPoints, type GrammarPoint } from './grammar'
import { grammarQuestions, QUIZ_BLANK } from './grammarQuiz'
import { toCsv } from './csv'

export function grammarLearning(attempts: readonly Attempt[]) {
  const history = attempts.filter((a) => a.subject === 'grammar' && !a.revoked && (a.kind === 'grammar-quiz' || a.kind === 'review'))
    .sort((a, b) => a.seq - b.seq)
  const first = new Map<string, Attempt>()
  const latest = new Map<string, Attempt>()
  const errors = new Map<string, number>()
  for (const a of history) {
    if (a.kind === 'grammar-quiz' && !first.has(a.wordId)) first.set(a.wordId, a)
    latest.set(a.wordId, a)
    if (a.grade !== 'A') errors.set(a.wordId, (errors.get(a.wordId) ?? 0) + 1)
  }
  return { history, first, latest, errors }
}

export function summarizeGrammar(attempts: readonly Attempt[], points: readonly GrammarPoint[] = grammarPoints) {
  const ids = new Set(points.map((p) => p.id))
  const { history, first } = grammarLearning(attempts.filter((a) => ids.has(a.wordId)))
  const practice = history.filter((a) => a.kind === 'grammar-quiz')
  const firstAnswers = [...first.values()]
  const correct = practice.filter((a) => a.grade === 'A').length
  return {
    total: points.length, covered: first.size, coverage: points.length ? first.size / points.length : 0,
    answered: practice.length, correct, accuracy: practice.length ? correct / practice.length : null,
    firstAccuracy: firstAnswers.length ? firstAnswers.filter((a) => a.grade === 'A').length / firstAnswers.length : null,
  }
}

export function grammarAttemptsCsv(attempts: readonly Attempt[]): string {
  const rows = [...attempts].filter((a) => a.subject === 'grammar').sort((a, b) => a.seq - b.seq).map((a) => {
    const point = grammarById.get(a.wordId)
    const q = grammarQuestions.get(a.wordId)
    return [a.id, a.answeredAt, a.kind, a.sessionId, a.wordId, point?.level, point?.pattern, q?.prompt,
      a.choice, q?.answer, a.grade, a.kind === 'baseline' ? '' : a.grade === 'A' ? 'correct' : 'incorrect',
      a.stage, a.durationMs, a.revoked ? 'yes' : '']
  })
  return toCsv([['attempt_id', 'answered_at', 'kind', 'session_id', 'grammar_id', 'level', 'pattern', 'prompt',
    'choice', 'answer', 'grade', 'result', 'stage', 'duration_ms', 'revoked'], ...rows], { guardFormulas: true })
}

export function grammarResultsCsv(points: readonly GrammarPoint[], attempts: readonly Attempt[], items: readonly ReviewItem[]): string {
  const { first, latest, errors } = grammarLearning(attempts)
  const queue = new Map(items.map((i) => [i.wordId, i]))
  return toCsv([['grammar_id', 'level', 'pattern', 'prompt', 'answer', 'first_result', 'latest_result', 'errors', 'review_status', 'review_stage', 'review_due'],
    ...points.map((p) => {
      const q = grammarQuestions.get(p.id)
      const r = queue.get(p.id)
      return [p.id, p.level, p.pattern, q?.prompt, q?.answer, first.get(p.id)?.grade, latest.get(p.id)?.grade,
        errors.get(p.id) ?? 0, r?.status, r?.stage, r?.status === 'active' ? r.dueDate : '']
    })], { guardFormulas: true })
}

export function grammarQuestionsCsv(points: readonly GrammarPoint[]): string {
  return toCsv([['grammar_id', 'level', 'pattern', 'prompt', 'answer', 'option_1', 'option_2', 'option_3', 'option_4', 'explanation'],
    ...points.map((p) => {
      const q = grammarQuestions.get(p.id)
      return [p.id, p.level, p.pattern, q?.prompt, q?.answer, ...(q?.options ?? ['', '', '', '']), q?.explanation]
    })], { guardFormulas: true })
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')

export function grammarAnkiCsv(points: readonly GrammarPoint[]): string {
  const head = ['#separator:Comma', '#html:true', '#notetype:Basic', '#deck:JLPT 语法错题', '#guid column:1', '#tags column:4']
  const rows = points.flatMap((p) => {
    const q = grammarQuestions.get(p.id)
    if (!q) return []
    return [[`grammar:${p.id}`, [q.prompt, ...q.options.map((o, i) => `${i + 1}. ${o}`)].map(escapeHtml).join('<br>'),
      [q.prompt.replace(QUIZ_BLANK, q.answer), q.explanation].map(escapeHtml).join('<br><br>'), `jlpt-grammar ${p.level}`]]
  })
  return head.join('\r\n') + '\r\n' + toCsv(rows)
}
