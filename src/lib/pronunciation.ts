// 发音数据：优先使用词表里的假名读音，用户可以手动纠正读音与重音位置。
// 重音只来自用户手动输入；项目里没有经过验证的重音数据，因此不填、不猜，显示为「待校验」。
import type { Word } from '../types'
import { isKana, moraCount } from './kana'

export interface PronOverride {
  /** 手动纠正的假名读音 */
  reading?: string
  /** 重音核位置：0=平板，n=第 n 拍之后下降 */
  accent?: number
}

export interface Pronunciation {
  /** 实际朗读的假名 */
  kana: string
  accent?: number
  /** user=用户手动指定；pending=缺少权威资料，待校验 */
  accentStatus: 'user' | 'pending'
  readingOverridden: boolean
}

const KEY = 'jvs-pron'

function load(): Record<string, PronOverride> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

export const getOverride = (wordId: string): PronOverride | undefined => load()[wordId]

/** 校验并保存。空对象表示清除。非法输入抛错，不写入。 */
export function setOverride(wordId: string, o: PronOverride, baseReading = ''): void {
  const clean: PronOverride = {}
  if (o.reading) {
    if (!isKana(o.reading)) throw new Error('读音只能是平假名或片假名')
    clean.reading = o.reading
  }
  if (o.accent !== undefined) {
    const n = moraCount(clean.reading ?? baseReading)
    if (!Number.isInteger(o.accent) || o.accent < 0 || o.accent > n) throw new Error(`重音位置必须是 0（平板）到 ${n}（拍数）之间的整数`)
    clean.accent = o.accent
  }
  const all = load()
  if (clean.reading === undefined && clean.accent === undefined) delete all[wordId]
  else all[wordId] = clean
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    throw new Error('无法保存到浏览器存储')
  }
}

/** 取词表读音为准；没有读音时才退回词形。汉字不交给引擎自行判断读法。 */
export function resolvePronunciation(w: Pick<Word, 'id' | 'word' | 'reading'>): Pronunciation {
  const o = getOverride(w.id)
  const kana = o?.reading || w.reading || w.word
  return {
    kana,
    accent: o?.accent,
    accentStatus: o?.accent === undefined ? 'pending' : 'user',
    readingOverridden: !!o?.reading && o.reading !== w.reading,
  }
}
