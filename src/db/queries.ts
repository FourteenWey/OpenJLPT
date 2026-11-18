// 只读查询：首评、作答日志。
import type { Attempt, Baseline, StudySubject } from '../types'
import { getAll, req, run } from './db'

export const baselineStore = (subject?: StudySubject) => subject === 'grammar' ? 'grammarBaselines' : 'baselines'

export async function getBaselineMap(db: IDBDatabase, subject?: StudySubject): Promise<Map<string, Baseline>> {
  return new Map((await getAll<Baseline>(db, baselineStore(subject))).map((b) => [b.wordId, b]))
}

export async function getAllAttempts(db: IDBDatabase, subject?: StudySubject): Promise<Attempt[]> {
  const attempts = await getAll<Attempt>(db, 'attempts')
  return subject ? attempts.filter((a) => (a.subject ?? 'vocabulary') === subject) : attempts
}

export const readSessionAttempts = (tx: IDBTransaction, sessionId: string) =>
  req<Attempt[]>(tx.objectStore('attempts').index('bySession').getAll(sessionId))

export function getSessionAttempts(db: IDBDatabase, sessionId: string): Promise<Attempt[]> {
  return run(db, ['attempts'], 'readonly', async (tx) => {
    const rows = await readSessionAttempts(tx, sessionId)
    return rows.sort((a, b) => a.seq - b.seq)
  })
}
