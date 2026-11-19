import type { Example, Grade, Word } from '../types'
import { GRADE_KEY, GRADE_LABEL } from '../types'
import { splitAtWord } from '../lib/example'
import { zhGloss } from '../lib/gloss'
import { BookmarkButton } from './BookmarkControls'
import { PronPanel } from './PronPanel'

const POS_ZH: Record<string, string> = {
  n: '名词', 'n-suf': '后缀名词', 'n-pref': '前缀名词', pn: '代词', num: '数词', ctr: '量词',
  v1: '一段动词', 'v1-s': '一段动词', vt: '他动词', vi: '自动词', vs: 'する动词', 'vs-s': 'する动词', 'vs-i': 'する动词', vk: '来る',
  v5aru: '五段动词', v5b: '五段动词', v5g: '五段动词', v5k: '五段动词', 'v5k-s': '五段动词', v5m: '五段动词', v5n: '五段动词',
  v5r: '五段动词', 'v5r-i': '五段动词', v5s: '五段动词', v5t: '五段动词', v5u: '五段动词', 'v5u-s': '五段动词', vz: '一段动词',
  'adj-i': 'い形容词', 'adj-ix': 'い形容词', 'adj-na': 'な形容词', 'adj-no': 'の形容词', 'adj-pn': '连体词', 'adj-f': '连体修饰',
  adv: '副词', 'adv-to': '副词(と)', conj: '接续词', int: '感叹词', exp: '惯用表达', pref: '接头词', suf: '接尾词', prt: '助词',
  'aux-v': '助动词', aux: '助动词', 'aux-adj': '助动词',
}

export const posLabel = (code: string) => POS_ZH[code] ?? code

export function posLabels(codes: string[]): string[] {
  return [...new Set(codes.map(posLabel))]
}

/** 例句：只显示日文句子并标出目标词。 */
function ExampleLine({ word, example }: { word: Word; example: Example }) {
  const parts = splitAtWord(example.ja, word)
  return (
    <div className="card-example">
      <p lang="ja">{parts ? <>{parts[0]}<mark>{parts[1]}</mark>{parts[2]}</> : example.ja}</p>
    </div>
  )
}

interface CardProps {
  word: Word
  revealed: boolean
  /** 暂停时遮住词形，避免暂停中偷看 */
  masked?: boolean
  badge?: string
  /** 在词形下方显示例句（读音提示） */
  showExample?: boolean
  onReveal?: () => void
  onResume?: () => void
  onBookmarkDialogChange?: (open: boolean) => void
  disabled?: boolean
  /** 提供时，翻面后显示发音按钮 */
  onSpeak?: () => void
}

export function Card({ word, revealed, masked, badge, showExample, onReveal, onResume, disabled, onSpeak, onBookmarkDialogChange }: CardProps) {
  const zh = zhGloss(word)
  return (
    <section className="card" aria-live="polite">
      {badge && <div className="card-badge">{badge}</div>}
      <div className="card-word" lang={masked ? undefined : 'ja'}>{masked ? '已暂停' : word.word}</div>
      {!masked && showExample && word.example && <ExampleLine word={word} example={word.example} />}
      {masked ? (
        <button className="primary" onClick={onResume} disabled={disabled}>继续练习 <kbd>Space</kbd></button>
      ) : revealed ? (
        <div className="card-answer">
          <div className="card-reading" lang="ja">{word.reading}</div>
          {onSpeak && <PronPanel word={word} onSpeak={onSpeak} />}
          {zh && (
            <div className="card-zh">
              {zh.text}
              {zh.generated && <span className={zh.check ? 'gen-tag check' : 'gen-tag'} title="未经人工校对，请以你自己的词表为准">{zh.check ? 'AI 生成 · 待核对' : 'AI 生成'}</span>}
            </div>
          )}
          {word.pos.length > 0 && <div className="card-pos">{posLabels(word.pos).join(' · ')}</div>}
          <BookmarkButton subject="vocabulary" itemId={word.id} label={word.word} disabled={disabled} onDialogChange={onBookmarkDialogChange} />
        </div>
      ) : (
        <div className="card-hint">先回忆读音与词义</div>
      )}
      {!masked && !revealed && <div className="study-actions reveal-actions">
        <button className="primary" onClick={onReveal} disabled={disabled}>显示答案 <kbd>Space</kbd></button>
      </div>}
    </section>
  )
}

const HINT: Record<Grade, string> = {
  A: '读音与词义都能独立回忆',
  B: '只记得一部分，或需要联想',
  C: '想不起来，或记错了',
}

interface GradeBarProps {
  enabled: boolean
  grammar?: boolean
  onGrade: (g: Grade) => void
}

export function GradeBar({ enabled, grammar, onGrade }: GradeBarProps) {
  return (
    <div className="grades" role="group" aria-label="评级">
      {(['A', 'B', 'C'] as Grade[]).map((g) => (
        <button
          key={g}
          className={`grade grade-${g}`}
          disabled={!enabled}
          onClick={() => onGrade(g)}
        >
          <kbd>{GRADE_KEY[g]}</kbd>
          <strong>{g === 'A' ? '确定掌握' : g === 'B' ? '模糊记得' : GRADE_LABEL[g]}</strong>
          <small>{grammar && g === 'A' ? '能独立回忆句型、接续和用法' : HINT[g]}</small>
        </button>
      ))}
    </div>
  )
}
