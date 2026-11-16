// 错词复习调度：当天、次日、第3天、第7天、第14天复测。
import type { Grade, ReviewItem } from '../types'

/** 相对首次进入队列当天的天数偏移。 */
export const REVIEW_OFFSETS = [0, 1, 3, 7, 14] as const
export const STAGE_LABELS = ['当天', '次日', '第3天', '第7天', '第14天'] as const
export const LAST_STAGE = REVIEW_OFFSETS.length - 1

const pad = (n: number) => String(n).padStart(2, '0')

/** 本地日历日，格式 YYYY-MM-DD。 */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return localDate(new Date(y, m - 1, d + days))
}

/** 首评为 B/C 的词进入队列：阶段 0，当天即可复测。 */
export function newReviewItem(wordId: string, grade: Grade, now: Date = new Date()): ReviewItem {
  return {
    wordId,
    stage: 0,
    dueDate: localDate(now),
    status: 'active',
    lapses: 0,
    reviewCount: 0,
    enteredAt: now.toISOString(),
    lastGrade: grade,
  }
}

/**
 * 记录一次复测。A：进入下一阶段，间隔为两阶段偏移之差（按时完成时恰为第 1/3/7/14 天）；
 * 通过最后阶段后毕业。B 或 C 视为答错：回到阶段 0，当天重新复测。
 */
export function applyReview(item: ReviewItem, grade: Grade, now: Date = new Date()): ReviewItem {
  const today = localDate(now)
  const base = { ...item, lastGrade: grade, lastReviewedAt: now.toISOString(), reviewCount: item.reviewCount + 1 }
  if (grade !== 'A') return { ...base, stage: 0, dueDate: today, status: 'active', lapses: item.lapses + 1 }
  if (item.stage >= LAST_STAGE) return { ...base, status: 'graduated' }
  const next = item.stage + 1
  return { ...base, stage: next, dueDate: addDays(today, REVIEW_OFFSETS[next] - REVIEW_OFFSETS[item.stage]) }
}

export function isDue(item: ReviewItem, today: string): boolean {
  return item.status === 'active' && item.dueDate <= today
}

/** 到期复测顺序：越早到期越靠前；刚答错的词排在同日队列末尾。 */
export function sortDue(items: ReviewItem[]): ReviewItem[] {
  return [...items].sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) ||
      (a.lastReviewedAt ?? '').localeCompare(b.lastReviewedAt ?? '') ||
      a.wordId.localeCompare(b.wordId),
  )
}
