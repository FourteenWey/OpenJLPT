import type { Word } from '../types'

export interface ZhGloss {
  text: string
  /** true 表示来自随项目提供的 AI 生成释义，而不是用户导入的词表 */
  generated: boolean
  /** 生成释义里标记为「没把握」的 */
  check: boolean
}

/** 中文释义：用户导入的优先，其次是生成的；都没有则为 null。 */
export function zhGloss(w: Pick<Word, 'meaningZh' | 'meaningZhGen' | 'zhGenCheck'>): ZhGloss | null {
  if (w.meaningZh) return { text: w.meaningZh, generated: false, check: false }
  if (w.meaningZhGen) return { text: w.meaningZhGen, generated: true, check: !!w.zhGenCheck }
  return null
}
