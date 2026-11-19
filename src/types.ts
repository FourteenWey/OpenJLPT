// 数据模型。所有时间字段使用 ISO 字符串；复习日期使用本地日历日 YYYY-MM-DD。

/** A=确定掌握（键 A），B=模糊记得（键 S），C=不认识（键 D）。 */
export type Grade = 'A' | 'B' | 'C'

export type StudySubject = 'vocabulary' | 'grammar'

export interface BookmarkTarget {
  subject: StudySubject
  itemId: string
}

export interface Bookmark extends BookmarkTarget {
  id: string
  note: string
  createdAt: string
  updatedAt: string
}

export type JlptLevel = `N${1 | 2 | 3 | 4 | 5}`

/** 每个级别有独立样本框，累计词表和自定义词表也各自统计。 */
export type Scope = `${JlptLevel}-only` | 'N5-N3-cumulative' | 'custom'

/** complete=词表即完整样本框；curated=人为挑选，不做总体估计。 */
export type FrameType = 'complete' | 'curated'

/** 例句。OpenJLPT 的例句来自 Tatoeba（CC BY 2.0 FR），不含注音。 */
export interface Example {
  ja: string
  translation?: string
  tatoebaId?: number
}

export interface Word {
  id: string
  word: string
  reading: string
  /** 英文释义（OpenJLPT / JMdict 来源） */
  meanings: string[]
  example?: Example
  /** 用户导入词表自带的中文释义，优先于生成释义 */
  meaningZh?: string
  /** 随项目提供的 AI 生成中文释义（未经人工校对），导入的 meaningZh 会覆盖它的显示 */
  meaningZhGen?: string
  /** 生成释义标记为「没把握，待核对」 */
  zhGenCheck?: boolean
  /** JMdict 词性代码，例如 n、v5r、adj-i */
  pos: string[]
  level?: string
  jmdictId?: number
  otherForms?: string[]
}

export interface WordlistSource {
  label: string
  url?: string
  version?: string
  license?: string
  attribution?: string
}

export interface Wordlist {
  id: string
  name: string
  scope: Scope
  frameType: FrameType
  wordIds: string[]
  createdAt: string
  source: WordlistSource
}

export type StudyFrame = Pick<Wordlist, 'id' | 'name' | 'scope' | 'frameType' | 'wordIds'>

export type SessionStatus = 'active' | 'paused' | 'completed'

/** 首次基线测试会话。order 保存抽样/洗牌后的完整顺序，用于断点恢复。 */
export interface Session {
  id: string
  /** 旧会话缺省为词汇。 */
  subject?: StudySubject
  /** 语法单选按会话计分，旧语法会话仍使用首评。 */
  grammarQuiz?: boolean
  /** 已提交答案、尚未离开解析页的语法点。 */
  quizFeedback?: { wordId: string; attemptId: string }
  mode: 'sample' | 'census'
  wordlistId: string
  wordlistName: string
  scope: Scope
  frameType: FrameType
  frameSize: number
  /** 样本框（排序后词 ID）的哈希，用于核对抽样可复现 */
  frameHash: string
  seed: number
  /** 测试条件：example=词形下方显示例句作为读音提示；缺省或 none=只显示词形 */
  hint?: 'example' | 'none'
  sampleSize: number
  order: string[]
  /** 创建时已存在首评、将直接沿用的词数 */
  preRated: number
  drawnAt: string
  createdAt: string
  updatedAt: string
  cursor: number
  status: SessionStatus
  /** 累计有效作答时间（不含暂停与页面隐藏） */
  activeMs: number
  completedAt?: string
}

export interface Attempt {
  id: string
  subject?: StudySubject
  /** 单调递增序号，用于确定「上一步」，避免同一毫秒内的并列 */
  seq: number
  kind: 'baseline' | 'review' | 'grammar-quiz'
  /** 基线会话 ID；复习为 'review' */
  sessionId: string
  wordId: string
  grade: Grade
  /** 语法单选实际选中的文本。 */
  choice?: string
  /** 复习时作答前所处的阶段 */
  stage?: number
  answeredAt: string
  /** 从出题到显示答案的有效毫秒数，未显示答案为 0 */
  revealMs: number
  /** 从出题到评级的有效毫秒数 */
  durationMs: number
  /** 被撤销的记录保留在日志中，但不参与统计 */
  revoked?: boolean
  /** 复习或语法快筛作答前的队列状态，撤销时据此还原；无值表示当时尚未入队。 */
  prev?: ReviewItem
}

/** 每词唯一、只写一次的首次判断。复习成绩永远不会写入这里。 */
export interface Baseline {
  wordId: string
  grade: Grade
  attemptId: string
  sessionId: string
  wordlistId: string
  ratedAt: string
  durationMs: number
}

export interface ReviewItem {
  wordId: string
  /** 0..4，对应当天、次日、第3天、第7天、第14天 */
  stage: number
  dueDate: string
  status: 'active' | 'graduated'
  lapses: number
  reviewCount: number
  enteredAt: string
  lastGrade: Grade
  lastReviewedAt?: string
}

export const GRADE_LABEL: Record<Grade, string> = { A: '掌握', B: '模糊', C: '不认识' }
export const GRADE_KEY: Record<Grade, string> = { A: 'A', B: 'S', C: 'D' }
