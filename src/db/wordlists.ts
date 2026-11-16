// 词表与词条：查询、导入保存、删除。
import type { FrameType, Word, Wordlist } from '../types'
import { parseWordFile, planImport, type ImportPlan, type ImportReport } from '../lib/importer'
import { uid } from '../lib/rng'
import { getAll, getOne, req, run } from './db'

export const listWordlists = (db: IDBDatabase) => getAll<Wordlist>(db, 'wordlists')
export const getWordlist = (db: IDBDatabase, id: string) => getOne<Wordlist>(db, 'wordlists', id)
export const getAllWords = (db: IDBDatabase) => getAll<Word>(db, 'words')

export function getWords(db: IDBDatabase, ids: string[]): Promise<Word[]> {
  return run(db, ['words'], 'readonly', async (tx) => {
    const store = tx.objectStore('words')
    const found = await Promise.all(ids.map((id) => req(store.get(id) as IDBRequest<Word | undefined>)))
    return found.filter((w): w is Word => !!w)
  })
}

export function putWords(db: IDBDatabase, words: Word[]): Promise<void> {
  if (!words.length) return Promise.resolve()
  return run(db, ['words'], 'readwrite', async (tx) => {
    const store = tx.objectStore('words')
    await Promise.all(words.map((w) => req(store.put(w))))
  })
}

/** 同一事务里写入新词、补充过的旧词和词表本身，失败则整体回滚。 */
export async function saveImport(tx: IDBTransaction, list: Wordlist, plan: ImportPlan): Promise<void> {
  const words = tx.objectStore('words')
  await Promise.all([...plan.newWords, ...plan.updatedWords].map((w) => req(words.put(w))))
  await req(tx.objectStore('wordlists').put(list))
}

export interface CustomImportInput {
  name: string
  frameType: FrameType
  fileName: string
  text: string
}

export async function importCustomList(db: IDBDatabase, input: CustomImportInput): Promise<{ list: Wordlist; report: ImportReport }> {
  const name = input.name.trim()
  if (!name) throw new Error('请填写词表名称')
  const { raw, invalid, rows } = parseWordFile(input.fileName, input.text)
  return run(db, ['words', 'wordlists'], 'readwrite', async (tx) => {
    const existing = (await req(tx.objectStore('words').getAll())) as Word[]
    const plan = planImport(raw, existing, invalid, rows)
    if (!plan.wordIds.length) throw new Error(`没有可导入的词条（无效行 ${invalid.length}）`)
    const list: Wordlist = {
      id: `custom-${uid()}`,
      name,
      scope: 'custom',
      frameType: input.frameType,
      wordIds: plan.wordIds,
      createdAt: new Date().toISOString(),
      source: { label: `用户导入：${input.fileName}` },
    }
    await saveImport(tx, list, plan)
    return { list, report: plan.report }
  })
}

/** 只删除词表记录；词条、首评与复习数据保持不变。 */
export function deleteWordlist(db: IDBDatabase, id: string): Promise<void> {
  return run(db, ['wordlists'], 'readwrite', async (tx) => {
    await req(tx.objectStore('wordlists').delete(id))
  })
}
