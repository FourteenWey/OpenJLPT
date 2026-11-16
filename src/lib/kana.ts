// 假名工具：转片假名、按拍（モーラ）切分、生成 VOICEVOX / AquesTalk 风格的假名文本。

const SMALL = new Set('ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ')

/** 只含平假名、片假名和长音符（允许「・」分隔，不允许汉字、空格）。 */
export const isKana = (s: string): boolean => /^[\u3041-\u3096\u30A1-\u30FA\u30FCー]+$/.test(s)

export function toKatakana(s: string): string {
  return s.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
}

/** 按拍切分：拗音、小写元音与前一个假名合为一拍；促音ッ、拨音ン、长音ー各占一拍。 */
export function splitMora(kana: string): string[] {
  const out: string[] = []
  for (const ch of kana) {
    if (SMALL.has(ch) && out.length) out[out.length - 1] += ch
    else out.push(ch)
  }
  return out
}

export const moraCount = (kana: string): number => splitMora(kana).length

/**
 * 生成带重音记号的片假名文本，供引擎 /accent_phrases?is_kana=true 使用。
 * accent：0=平板，n=第 n 拍之后下降。VOICEVOX 用「重音位置 = 拍数」表示平板，所以 0 会换成拍数。
 */
export function toAccentKana(reading: string, accent: number): string {
  const mora = splitMora(toKatakana(reading))
  const pos = accent === 0 ? mora.length : accent
  return mora.map((m, i) => (i + 1 === pos ? `${m}'` : m)).join('')
}
