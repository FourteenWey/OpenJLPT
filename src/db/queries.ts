// 只读查询：首评、作答日志。
import type { Attempt, Baseline } from '../types'
import { getAll, req, run } from './db'

export async function getBaselineMap(db: IDBDatabase): Promise<Map<string, Baseline>> {
  return new Map((await getAll<Baseline>(db, 'baselines')).map((b) => [b.wordId, b]))
}

export const getAllAttempts = (db: IDBDatabase) => getAll<Attempt>(db, 'attempts')

export function getSessionAttempts(db: IDBDatabase, sessionId: string): Promise<Attempt[]> {
  return run(db, ['attempts'], 'readonly', async (tx) => {
    const rows = (await req(tx.objectStore('attempts').index('bySession').getAll(sessionId))) as Attempt[]
    return rows.sort((a, b) => a.seq - b.seq)
  })
}
