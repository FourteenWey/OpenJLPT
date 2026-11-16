// IndexedDB 基础封装：打开数据库、事务辅助、设置读写。
export const DB_NAME = 'jlpt-vocab-scanner'
export const DB_VERSION = 1

export const STORE_KEYS = {
  wordlists: 'id',
  words: 'id',
  sessions: 'id',
  attempts: 'id',
  baselines: 'wordId',
  reviewItems: 'wordId',
  settings: 'key',
} as const

export type StoreName = keyof typeof STORE_KEYS
export const STORE_NAMES = Object.keys(STORE_KEYS) as StoreName[]

export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('事务已中止'))
  })
}

export function openDb(name: string = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, DB_VERSION)
    open.onupgradeneeded = () => {
      const db = open.result
      for (const store of STORE_NAMES) {
        const os = db.createObjectStore(store, { keyPath: STORE_KEYS[store] })
        if (store === 'attempts') os.createIndex('bySession', 'sessionId')
      }
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
}

/**
 * 在单个事务里执行 fn。fn 内只能 await IDB 请求（不要 await 其它异步操作，否则事务会提前提交）。
 * fn 抛错则整个事务回滚。
 */
export async function run<T>(
  db: IDBDatabase,
  stores: StoreName[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const tx = db.transaction(stores, mode)
  const done = txDone(tx)
  done.catch(() => {})
  try {
    const result = await fn(tx)
    await done
    return result
  } catch (err) {
    try {
      tx.abort()
    } catch {
      /* 事务已结束 */
    }
    await done.catch(() => {})
    throw err
  }
}

export const getAll = <T>(db: IDBDatabase, store: StoreName): Promise<T[]> =>
  run(db, [store], 'readonly', (tx) => req(tx.objectStore(store).getAll() as IDBRequest<T[]>))

export const getOne = <T>(db: IDBDatabase, store: StoreName, key: string): Promise<T | undefined> =>
  run(db, [store], 'readonly', (tx) => req(tx.objectStore(store).get(key) as IDBRequest<T | undefined>))

export async function getSetting<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  const rec = await getOne<{ key: string; value: T }>(db, 'settings', key)
  return rec?.value
}

export const putSetting = (db: IDBDatabase, key: string, value: unknown): Promise<void> =>
  run(db, ['settings'], 'readwrite', async (tx) => {
    await req(tx.objectStore('settings').put({ key, value }))
  })
