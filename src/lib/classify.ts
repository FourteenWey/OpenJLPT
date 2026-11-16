// 词汇维度分类：词性、假名词/汉字词、复合动词。
import type { Word } from '../types'

export type PosClass = '名词' | 'する名词' | '动词' | 'い形容词' | 'な形容词' | '副词' | '其他' | '未标注'

const HAN = /[\p{Script=Han}々〆]/u
const VERB_CODE = /^(v1|v5|vk|vz|vs-i|vs-s)/

export function hasKanji(text: string): boolean {
  return HAN.test(text)
}

export function isVerb(w: Pick<Word, 'pos'>): boolean {
  return w.pos.some((p) => VERB_CODE.test(p))
}

/** 每个词只归入一个词性大类，保证各行数量相加等于总数。 */
export function posClass(w: Pick<Word, 'pos'>): PosClass {
  if (!w.pos.length) return '未标注'
  if (isVerb(w)) return '动词'
  if (w.pos.includes('vs')) return 'する名词'
  const first = w.pos.find((p) => p !== 'adj-no' && p !== 'adj-f') ?? w.pos[0]
  if (first === 'adj-i' || first === 'adj-ix') return 'い形容词'
  if (first === 'adj-na') return 'な形容词'
  if (first === 'adv' || first === 'adv-to') return '副词'
  if (first === 'n' || first === 'n-suf' || first === 'n-pref') return '名词'
  return '其他'
}

export type ScriptClass = '假名词' | '汉字词'

export function scriptClass(w: Pick<Word, 'word'>): ScriptClass {
  return hasKanji(w.word) ? '汉字词' : '假名词'
}

const H = '[\\p{Script=Han}々]'
// 汉字 + 一个连用形假名（い/え段）+ 汉字…，如 話し合う、受け取る、飛び出す。
// 不含「気に入る」「引っ張る」这类助词短语或接头词动词。
const STEM_PATTERN = new RegExp(`^${H}+[いきぎしじちびみりえけげせてべめれ]${H}+[\\u3041-\\u3096]*$`, 'u')
// 常见后项动词，前项是 1–2 个汉字的连用形，如 似合う、見直す。
const V2 = ['込む', '込める', '出す', '合う', '直す', '続ける', '始める', '過ぎる', '上げる', '上がる', '返す', '回す', '落とす', '忘れる', '通す', '渡す', '尽くす', '損なう', '損ねる']
const V2_PATTERN = new RegExp(`^${H}{1,2}(${V2.join('|')})$`, 'u')

/**
 * 复合动词（複合動詞）启发式判断。没有形态分析器，规则偏保守，
 * 可能漏判少量只用假名书写的词；统计页会标注其为启发式结果。
 */
export function isCompoundVerb(w: Pick<Word, 'word' | 'pos'>): boolean {
  if (!isVerb(w)) return false
  return STEM_PATTERN.test(w.word) || V2_PATTERN.test(w.word)
}

export type CompoundClass = '复合动词' | '其他动词'
