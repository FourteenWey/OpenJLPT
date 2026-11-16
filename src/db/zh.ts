// 随项目提供的 AI 生成中文释义（public/data/openjlpt-n3-zh.json），按词 ID 合并到本地词条。
import type { Word } from '../types'
import { req, run } from './db'
import type { JsonFetcher } from './builtin'

interface ZhFile {
  entries: Record<string, string>
  /** 生成时标记为没把握的词 ID */
  uncertain?: string[]
}

const defaultFetcher: JsonFetcher = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/**
 * 把生成释义写入词条的 meaningZhGen。幂等：已是最新的词不会重复写入。
 * 不会碰用户导入的 meaningZh。文件缺失或读取失败时静默跳过，应用照常使用英文释义。
 */
export async function applyGeneratedZh(
  db: IDBDatabase,
  fetcher: JsonFetcher = defaultFetcher,
  base: string = import.meta.env.BASE_URL,
): Promise<number> {
  let file: ZhFile
  try {
    file = (await fetcher(`${base}data/openjlpt-n3-zh.json`)) as ZhFile
    if (!file?.entries || typeof file.entries !== 'object') return 0
  } catch {
    return 0
  }
  const check = new Set(file.uncertain ?? [])
  return run(db, ['words'], 'readwrite', async (tx) => {
    const store = tx.objectStore('words')
    const all = (await req(store.getAll())) as Word[]
    const stale = all.filter((w) => file.entries[w.id] && (w.meaningZhGen !== file.entries[w.id] || !!w.zhGenCheck !== check.has(w.id)))
    await Promise.all(
      stale.map((w) => {
        const next: Word = { ...w, meaningZhGen: file.entries[w.id] }
        if (check.has(w.id)) next.zhGenCheck = true
        else delete next.zhGenCheck
        return req(store.put(next))
      }),
    )
    return stale.length
  })
}
