// 完整 JSON 备份与恢复。恢复会整体替换现有数据，并在单个事务里完成。
import { STORE_KEYS, STORE_NAMES, req, run, type StoreName } from './db'
import { backfillGrammarReview, GRAMMAR_MIGRATION_KEY } from './grammarMigration'

export const BACKUP_FORMAT = 'jlpt-vocab-scanner-backup'
export const BACKUP_VERSION = 3

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  data: Record<StoreName, unknown[]>
}

export async function exportBackup(db: IDBDatabase, now: Date = new Date()): Promise<BackupFile> {
  const data = await run(db, STORE_NAMES, 'readonly', async (tx) => {
    const tables = await Promise.all(STORE_NAMES.map(async (name) => [name, await req(tx.objectStore(name).getAll())] as const))
    return Object.fromEntries(tables) as Record<StoreName, unknown[]>
  })
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), data }
}

/** 校验备份文件结构，返回各表记录数；不合法时抛出带原因的错误。 */
export function validateBackup(input: unknown): { file: BackupFile; counts: Record<StoreName, number> } {
  const file = input as Partial<BackupFile> | null
  if (!file || typeof file !== 'object' || file.format !== BACKUP_FORMAT) throw new Error('不是本工具导出的备份文件')
  if (file.version !== 1 && file.version !== 2 && file.version !== BACKUP_VERSION) throw new Error(`不支持的备份版本：${String(file.version)}`)
  if (!file.data || typeof file.data !== 'object') throw new Error('备份文件缺少 data')
  const counts = {} as Record<StoreName, number>
  const data = { ...file.data }
  if (file.version === 1) data.grammarBaselines ??= []
  if (file.version < 3) data.grammarReviewItems = []
  for (const name of STORE_NAMES) {
    const rows = data[name]
    if (!Array.isArray(rows)) throw new Error(`备份缺少数据表：${name}`)
    const key = STORE_KEYS[name]
    rows.forEach((row, i) => {
      const k = (row as Record<string, unknown> | null)?.[key]
      if (typeof k !== 'string' || !k) throw new Error(`数据表 ${name} 第 ${i + 1} 条记录缺少主键 ${key}`)
    })
    counts[name] = rows.length
  }
  return { file: { ...file, data } as BackupFile, counts }
}

export async function restoreBackup(db: IDBDatabase, input: unknown): Promise<Record<StoreName, number>> {
  const { file, counts } = validateBackup(input)
  return run(db, STORE_NAMES, 'readwrite', async (tx) => {
    for (const name of STORE_NAMES) {
      const store = tx.objectStore(name)
      await req(store.clear())
      await Promise.all(file.data[name].map((row) => req(store.put(row))))
    }
    if (file.version < 3) {
      await req(tx.objectStore('settings').delete(GRAMMAR_MIGRATION_KEY))
      await req(tx.objectStore('settings').delete('grammar-review-feedback'))
      await backfillGrammarReview(tx)
      counts.grammarReviewItems = await req(tx.objectStore('grammarReviewItems').count())
    } else if (!(await req(tx.objectStore('settings').get(GRAMMAR_MIGRATION_KEY)))) {
      await req(tx.objectStore('settings').put({ key: GRAMMAR_MIGRATION_KEY, value: { count: 0, noticePending: false } }))
    }
    return counts
  })
}
