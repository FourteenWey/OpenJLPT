// 从 evanclan/OpenJLPT 的固定提交下载 N1–N5 词表，瘦身后写入 public/data。
// 生成结果已随项目提交，日常运行不需要联网；仅在想更新词表时执行 `npm run fetch-data`。
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'evanclan/OpenJLPT'
const COMMIT = '0d1d3410bec90bd4098a7c72de820543cb4f707c'
const RAW = `https://raw.githubusercontent.com/${REPO}/${COMMIT}`
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outData = join(root, 'public', 'data')
const outThird = join(root, 'third_party', 'OpenJLPT')

async function get(path, asJson) {
  // GitHub raw 偶尔很慢或超时，最多重试 4 次。
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${RAW}/${path}`, { signal: AbortSignal.timeout(60_000) })
      if (!res.ok) throw new Error(`下载失败 ${path}: HTTP ${res.status}`)
      return asJson ? await res.json() : await res.text()
    } catch (err) {
      if (attempt >= 4) throw err
      console.warn(`${path} 第 ${attempt} 次失败（${err.cause?.code ?? err.message}），重试…`)
    }
  }
}

const KANA_TAIL = /[\u3041-\u3096\u30a1-\u30fa\u30fc]+$/
const HAN = /[\u3400-\u9fff]/
const dropped = []

/**
 * 例句注音里目标词汉字部分的读法与词条读音比较：match=一致，conflict=不一致，
 * unknown=没有注音或找不到对应位置，无法判断。
 */
function readingCheck(word, reading, ex) {
  if (!ex.furigana) return 'unknown'
  const tail = word.match(KANA_TAIL)?.[0] ?? ''
  const kanjiPart = tail ? word.slice(0, -tail.length) : word
  if (!kanjiPart || !HAN.test(kanjiPart)) return 'unknown'
  const expected = tail && reading.endsWith(tail) ? reading.slice(0, -tail.length) : reading
  const hits = [...ex.furigana.matchAll(/\{([^|{}]+)\|([^{}]+)\}/g)].filter((t) => t[1] === kanjiPart)
  if (!hits.length) return 'unknown'
  return hits.some((t) => t[2] === expected) ? 'match' : 'conflict'
}

function slim(raw, level, ambiguous) {
  const seen = new Set()
  return raw.map((e) => {
    for (const k of ['id', 'word', 'reading', 'meanings', 'level']) {
      if (!e[k] || (Array.isArray(e[k]) && !e[k].length)) throw new Error(`${level} 缺少字段 ${k}: ${JSON.stringify(e)}`)
    }
    if (e.level !== level) throw new Error(`${level} 文件含有其它级别词条: ${e.id}`)
    if (seen.has(e.id)) throw new Error(`${level} 内 ID 重复: ${e.id}`)
    seen.add(e.id)
    const out = { id: e.id, word: e.word, reading: e.reading, meanings: e.meanings, level: e.level, pos: e.pos ?? [] }
    if (e.jmdict_id) out.jmdictId = e.jmdict_id
    if (e.other_forms?.length) out.otherForms = e.other_forms
    // 只取 1 条例句，不含注音，避免提前泄露读音。Tatoeba 例句按词形匹配，多音词的句子读音可能与词条不同
    // （如「今日」词条为こんにち，句子里读きょう）。有注音时据此剔除读音冲突的句子；
    // 同一词形有不同读音时，只保留注音能确认读音一致的句子。
    const ok = (x) => {
      if (!x.ja || !x.en) return false
      const status = readingCheck(e.word, e.reading, x)
      return status === 'match' || (status === 'unknown' && !ambiguous.has(e.word))
    }
    const ex = (e.examples ?? []).find(ok)
    if (ex) out.example = { ja: ex.ja, translation: ex.en, ...(ex.tatoeba_id ? { tatoebaId: ex.tatoeba_id } : {}) }
    if (e.examples?.length && !ex) dropped.push(`${e.word}(${e.reading})`)
    return out
  })
}

const meta = await get('data/json/meta.json', true)
await mkdir(outData, { recursive: true })
await mkdir(outThird, { recursive: true })

const LEVELS = ['N1', 'N2', 'N3', 'N4', 'N5']
const raws = {}
for (const level of LEVELS) raws[level] = await get(`data/json/vocab/${level.toLowerCase()}.json`, true)

// 同一词形对应多个读音的词（如 今日 きょう/こんにち）。保留已发布的 N3–N5 例句选择。
function ambiguousWords(levels) {
  const readings = new Map()
  for (const e of levels.flatMap((l) => raws[l])) readings.set(e.word, (readings.get(e.word) ?? new Set()).add(e.reading))
  return new Set([...readings].filter(([, r]) => r.size > 1).map(([w]) => w))
}

const ambiguous = ambiguousWords(LEVELS)
const originalAmbiguous = ambiguousWords(['N3', 'N4', 'N5'])

for (const level of LEVELS) {
  const entries = slim(raws[level], level, level === 'N1' || level === 'N2' ? ambiguous : originalAmbiguous)
  if (entries.length !== meta.counts.vocab[level]) {
    throw new Error(`${level} 数量 ${entries.length} 与 meta.json 的 ${meta.counts.vocab[level]} 不一致`)
  }
  await writeFile(join(outData, `openjlpt-${level.toLowerCase()}.json`), JSON.stringify({ level, count: entries.length, entries }))
  console.log(`${level}: ${entries.length} 词，${entries.filter((e) => e.example).length} 词带例句`)
}
console.log(`同词形多读音的词 ${ambiguous.size} 个；因读音无法确认而不带例句的词 ${dropped.length} 个：${dropped.slice(0, 30).join(' ')}`)

const source = {
  name: 'OpenJLPT',
  repository: `https://github.com/${REPO}`,
  commit: COMMIT,
  version: meta.version,
  license: meta.license,
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  upstream: 'JMdict and KANJIDIC2 (EDRDG), Jonathan Waller JLPT lists (tanos.co.uk), Tatoeba',
  levelNote: '每个词只出现在列出它的最简单级别。N1–N5 各自为独立词表。',
  fetchedFrom: `${RAW}/data/json/vocab/`,
}
await writeFile(join(outData, 'openjlpt-source.json'), JSON.stringify(source, null, 2) + '\n')
for (const f of ['LICENSE', 'NOTICE.md', 'CITATION.cff']) {
  await writeFile(join(outThird, f), await get(f, false))
}
console.log('完成：public/data 与 third_party/OpenJLPT 已更新')
