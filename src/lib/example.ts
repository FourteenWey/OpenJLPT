import type { Word } from '../types'
import { hasKanji } from './classify'

/** 单个汉字的词只在两侧都不是汉字时才算独立出现，避免把「週末」里的「末」当成目标词。 */
function findStandalone(sentence: string, c: string): number {
  const single = c.length === 1 && hasKanji(c)
  for (let i = sentence.indexOf(c); i >= 0; i = sentence.indexOf(c, i + 1)) {
    if (!single) return i
    const prev = sentence[i - 1] ?? ''
    const next = sentence[i + 1] ?? ''
    if (!hasKanji(prev) && !hasKanji(next)) return i
  }
  return -1
}

/**
 * 在例句里找到目标词，拆成 [前, 词, 后] 以便高亮。找不到返回 null（此时只显示句子，不高亮）。
 * Tatoeba 按词典形匹配，例句里的词可能活用了，所以带送假名的词再试一次去掉最后一个假名的词干。
 */
export function splitAtWord(sentence: string, word: Pick<Word, 'word'>): [string, string, string] | null {
  const w = word.word
  const candidates = [w]
  if (w.length >= 2 && hasKanji(w) && /[\u3041-\u3096]$/.test(w)) candidates.push(w.slice(0, -1))
  for (const c of candidates) {
    const i = findStandalone(sentence, c)
    if (i >= 0) return [sentence.slice(0, i), c, sentence.slice(i + c.length)]
  }
  return null
}
