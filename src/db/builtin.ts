// 内置 OpenJLPT 分级词表与 N5–N3 累计词表。
import type { Word, Wordlist } from '../types'
import { planImport, type ImportReport, type RawWord } from '../lib/importer'
import { getAllWords, getWordlist, listWordlists, putWords, saveImport } from './wordlists'
import { getSetting, putSetting, req, run } from './db'
import { applyGeneratedZh } from './zh'

const LEVELS = ['n1', 'n2', 'n3', 'n4', 'n5'] as const
type BuiltinLevel = (typeof LEVELS)[number]
export type BuiltinKind = BuiltinLevel | 'cumulative'
export const BUILTIN_IDS: Record<BuiltinKind, string> = {
  n1: 'openjlpt-n1-only',
  n2: 'openjlpt-n2-only',
  n3: 'openjlpt-n3-only',
  n4: 'openjlpt-n4-only',
  n5: 'openjlpt-n5-only',
  cumulative: 'openjlpt-n5-n3-cumulative',
}

export const BUILTIN_NAMES: Record<BuiltinKind, string> = {
  n1: 'OpenJLPT N1',
  n2: 'OpenJLPT N2',
  n3: 'OpenJLPT N3（仅 N3，不含 N4/N5）',
  n4: 'OpenJLPT N4',
  n5: 'OpenJLPT N5',
  cumulative: 'OpenJLPT N5–N3 累计',
}

const filesFor = (kind: BuiltinKind): BuiltinLevel[] => kind === 'cumulative' ? ['n5', 'n4', 'n3'] : [kind]

export function selectWordlist(lists: Wordlist[], id = BUILTIN_IDS.n3): Wordlist | undefined {
  return lists.find((list) => list.id === id) ?? lists.find((list) => list.id === BUILTIN_IDS.n3) ?? lists[0]
}

const ATTRIBUTION =
  'Contains data from OpenJLPT (https://github.com/evanclan/OpenJLPT, CC BY-SA 4.0), which uses JMdict and KANJIDIC2 (EDRDG), ' +
  "Jonathan Waller's JLPT lists (tanos.co.uk), and Tatoeba."

export type JsonFetcher = (url: string) => Promise<unknown>

const defaultFetcher: JsonFetcher = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`加载 ${url} 失败：HTTP ${res.status}`)
  return res.json()
}

interface LevelFile {
  level: string
  count: number
  entries: RawWord[]
}
interface SourceInfo {
  repository: string
  commit: string
  version: string
}

async function loadRaw(files: string[], fetcher: JsonFetcher, base: string): Promise<RawWord[]> {
  const raw: RawWord[] = []
  for (const f of files) {
    const file = (await fetcher(`${base}data/openjlpt-${f}.json`)) as LevelFile
    if (!Array.isArray(file.entries) || file.entries.length !== file.count) throw new Error(`词表文件 ${f} 数量与声明不一致`)
    raw.push(...file.entries)
  }
  return raw
}

/** 内置词条数据的版本。2：词条带例句。 */
const DATA_REV = 2

/**
 * 老版本数据库里的内置词条没有例句。启动时按稳定 ID 一次性补上，已有字段不动。
 * 还没有载入内置词表时什么也不做（之后载入的已经是最新数据）。
 */
export async function refreshBuiltinWords(
  db: IDBDatabase,
  fetcher: JsonFetcher = defaultFetcher,
  base: string = import.meta.env.BASE_URL,
): Promise<number> {
  if ((await getSetting<number>(db, 'builtinDataRev')) === DATA_REV) return 0
  const loaded: BuiltinKind[] = []
  for (const k of Object.keys(BUILTIN_IDS) as BuiltinKind[]) if (await getWordlist(db, BUILTIN_IDS[k])) loaded.push(k)
  if (!loaded.length) return 0
  const plan = planImport(await loadRaw([...new Set(loaded.flatMap(filesFor))], fetcher, base), await getAllWords(db))
  await putWords(db, plan.updatedWords)
  await putSetting(db, 'builtinDataRev', DATA_REV)
  return plan.updatedWords.length
}

export async function ensureBuiltin(
  db: IDBDatabase,
  kind: BuiltinKind,
  fetcher: JsonFetcher = defaultFetcher,
  base: string = import.meta.env.BASE_URL,
): Promise<{ list: Wordlist; created: boolean; report?: ImportReport }> {
  const id = BUILTIN_IDS[kind]
  const existing = await getWordlist(db, id)
  if (existing) return { list: existing, created: false }

  const files = filesFor(kind)
  const [source, raw] = await Promise.all([
    fetcher(`${base}data/openjlpt-source.json`) as Promise<SourceInfo>,
    loadRaw(files, fetcher, base),
  ])
  const result = await run(db, ['words', 'wordlists'], 'readwrite', async (tx) => {
    const current = (await req(tx.objectStore('wordlists').get(id))) as Wordlist | undefined
    if (current) return { list: current, created: false }

    const words = (await req(tx.objectStore('words').getAll())) as Word[]
    const plan = planImport(raw, words)
    const list: Wordlist = {
      id,
      name: BUILTIN_NAMES[kind],
      scope: kind === 'cumulative' ? 'N5-N3-cumulative' : `${kind.toUpperCase() as Uppercase<BuiltinLevel>}-only`,
      frameType: 'complete',
      wordIds: plan.wordIds,
      createdAt: new Date().toISOString(),
      source: {
        label: 'OpenJLPT',
        url: source.repository,
        version: `${source.version} @ ${source.commit.slice(0, 7)}`,
        license: 'CC BY-SA 4.0',
        attribution: ATTRIBUTION,
      },
    }
    await saveImport(tx, list, plan)
    return { list, created: true, report: plan.report }
  })
  if (result.created && files.includes('n3')) await applyGeneratedZh(db, fetcher, base)
  return result
}

/** 首次启动或打开旧备份时补齐五个分级词表。之后可以在数据页管理词表。 */
export async function prepareBuiltinWordlists(db: IDBDatabase): Promise<void> {
  const lists = await listWordlists(db)
  if (lists.length) await refreshBuiltinWords(db).catch(() => 0)
  if (!(await getSetting<boolean>(db, 'builtinLevelsInstalled'))) {
    for (const level of LEVELS) await ensureBuiltin(db, level)
    if (!lists.length) await putSetting(db, 'builtinDataRev', DATA_REV)
    await putSetting(db, 'builtinLevelsInstalled', true)
  } else if (!lists.length) {
    await ensureBuiltin(db, 'n3')
  }
  await applyGeneratedZh(db)
}
