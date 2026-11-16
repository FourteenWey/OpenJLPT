// 词表导入：CSV/JSON 解析、字段别名、按稳定 ID 与「词形+读音」去重。
import type { Example, Word } from '../types'
import { fnv1a } from './rng'
import { hasKanji } from './classify'
import { parseCsv } from './csv'

export interface RawWord {
  id?: string
  word: string
  reading: string
  meanings: string[]
  meaningZh?: string
  pos: string[]
  level?: string
  jmdictId?: number
  otherForms?: string[]
  example?: Example
}

export interface ImportReport {
  rows: number
  added: number
  linked: number
  duplicatesInFile: number
  invalid: { row: number; reason: string }[]
}

export interface ImportPlan {
  wordIds: string[]
  newWords: Word[]
  updatedWords: Word[]
  report: ImportReport
}

const ALIASES: Record<string, string[]> = {
  id: ['id', 'uid'],
  word: ['word', 'expression', 'headword', '单词', '词形', '词', '単語', '表记', '表記'],
  reading: ['reading', 'kana', 'furigana', '读音', '假名', '読み', '読み方'],
  meanings: ['meaning', 'meanings', 'gloss', 'definition', 'english', '释义', '意味', '英文'],
  meaningZh: ['meaning_zh', 'zh', 'chinese', '中文', '中文释义', '中文意思'],
  pos: ['pos', '词性', '品詞'],
  level: ['level', '级别', '等级'],
  otherForms: ['other_forms', 'otherforms', '其他写法'],
  jmdictId: ['jmdict_id', 'jmdictid'],
  exampleJa: ['example', 'example_ja', '例句', '例文'],
  exampleTr: ['example_translation', 'example_zh', 'example_en', '例句翻译', '例文翻訳'],
}

const norm = (s: string) => s.normalize('NFKC').trim()
const keyOf = (word: string, reading: string) => `${norm(word)}\u0000${norm(reading)}`
const strip = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, '_')

function canonicalKey(header: string): string | null {
  const h = strip(header)
  for (const [key, names] of Object.entries(ALIASES)) if (names.includes(h)) return key
  return null
}

function list(v: unknown): string[] {
  const parts = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(/[;；|]/) : []
  return parts.map((s) => s.trim()).filter(Boolean)
}

/** 以 JMdict 词性代码为准；多个词性用 ; , | 分隔。 */
const posList = (v: unknown) => (typeof v === 'string' ? v.split(/[;,；，|]/).map((s) => s.trim()).filter(Boolean) : list(v))

export function fromRecord(rec: Record<string, unknown>): RawWord | string {
  const r: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rec)) {
    const key = canonicalKey(k)
    if (key && r[key] === undefined) r[key] = v
  }
  const word = typeof r.word === 'string' ? r.word.trim() : ''
  if (!word) return '缺少词形'
  let reading = typeof r.reading === 'string' ? r.reading.trim() : ''
  if (!reading && !hasKanji(word)) reading = word
  if (!reading) return `「${word}」缺少读音`
  const zh = typeof r.meaningZh === 'string' ? r.meaningZh.trim() : ''
  const out: RawWord = { word, reading, meanings: list(r.meanings), pos: posList(r.pos) }
  if (typeof r.id === 'string' && r.id.trim()) out.id = r.id.trim()
  if (zh) out.meaningZh = zh
  if (typeof r.level === 'string' && r.level.trim()) out.level = r.level.trim()
  if (list(r.otherForms).length) out.otherForms = list(r.otherForms)
  const jm = Number(r.jmdictId)
  if (Number.isInteger(jm) && jm > 0) out.jmdictId = jm
  const example = parseExample(r.exampleJa, r.exampleTr)
  if (example) out.example = example
  return out
}

/** 例句可以是文本（配可选译文列），也可以是 { ja, translation } 对象（JSON）。 */
function parseExample(value: unknown, translation: unknown): Example | undefined {
  const obj = value && typeof value === 'object' ? (value as Partial<Example>) : undefined
  const ja = (typeof value === 'string' ? value : obj?.ja)?.trim()
  if (!ja) return undefined
  const tr = (typeof translation === 'string' ? translation : obj?.translation)?.trim()
  return { ja, ...(tr ? { translation: tr } : {}), ...(obj?.tatoebaId ? { tatoebaId: obj.tatoebaId } : {}) }
}

export function parseWordFile(fileName: string, text: string): { raw: RawWord[]; invalid: ImportReport['invalid']; rows: number } {
  let records: Record<string, unknown>[]
  if (/\.json$/i.test(fileName)) {
    const data = JSON.parse(text) as unknown
    const arr = Array.isArray(data) ? data : ((data as { entries?: unknown; words?: unknown }).entries ?? (data as { words?: unknown }).words)
    if (!Array.isArray(arr)) throw new Error('JSON 需要是词条数组，或包含 entries / words 数组的对象')
    records = arr as Record<string, unknown>[]
  } else {
    const [header, ...body] = parseCsv(text)
    if (!header || !header.some((h) => canonicalKey(h) === 'word')) {
      throw new Error('CSV 首行必须是表头，且包含 word（或 单词/词形）列；可选列：reading, meaning, meaning_zh, pos, level, id')
    }
    records = body.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])))
  }
  const raw: RawWord[] = []
  const invalid: ImportReport['invalid'] = []
  records.forEach((rec, i) => {
    const res = rec && typeof rec === 'object' ? fromRecord(rec) : '不是有效的词条对象'
    if (typeof res === 'string') invalid.push({ row: i + 1, reason: res })
    else raw.push(res)
  })
  return { raw, invalid, rows: records.length }
}

/** 自定义词条的稳定 ID：u_ 前缀 + 由「词形+读音」确定的 10 位十六进制。 */
export function makeId(word: string, reading: string): string {
  const text = `${norm(word)}\u0000${norm(reading)}`
  return `u_${fnv1a(text)}${fnv1a([...text].reverse().join('')).slice(0, 2)}`
}

export function planImport(raw: RawWord[], existing: Iterable<Word>, invalid: ImportReport['invalid'] = [], rows = raw.length): ImportPlan {
  const byId = new Map<string, Word>()
  const byKey = new Map<string, Word>()
  for (const w of existing) {
    byId.set(w.id, w)
    byKey.set(keyOf(w.word, w.reading), w)
  }
  const seen = new Set<string>()
  const wordIds: string[] = []
  const newWords: Word[] = []
  const updated = new Map<string, Word>()
  const report: ImportReport = { rows, added: 0, linked: 0, duplicatesInFile: 0, invalid }
  for (const r of raw) {
    const hit = (r.id ? byId.get(r.id) : undefined) ?? byKey.get(keyOf(r.word, r.reading))
    if (hit) {
      if (seen.has(hit.id)) {
        report.duplicatesInFile++
        continue
      }
      seen.add(hit.id)
      wordIds.push(hit.id)
      if (!newWords.includes(hit)) report.linked++
      if (!hit.meaningZh && r.meaningZh) {
        hit.meaningZh = r.meaningZh
        updated.set(hit.id, hit)
      }
      if (!hit.example && r.example) {
        hit.example = r.example
        updated.set(hit.id, hit)
      }
      continue
    }
    let id = r.id ?? makeId(r.word, r.reading)
    for (let n = 2; byId.has(id); n++) id = `${makeId(r.word, r.reading)}_${n}`
    const w: Word = { id, word: r.word, reading: r.reading, meanings: r.meanings, pos: r.pos }
    for (const k of ['meaningZh', 'level', 'jmdictId', 'otherForms', 'example'] as const) if (r[k] !== undefined) Object.assign(w, { [k]: r[k] })
    byId.set(id, w)
    byKey.set(keyOf(w.word, w.reading), w)
    seen.add(id)
    wordIds.push(id)
    newWords.push(w)
    report.added++
  }
  return { wordIds, newWords, updatedWords: [...updated.values()].filter((w) => !newWords.includes(w)), report }
}
