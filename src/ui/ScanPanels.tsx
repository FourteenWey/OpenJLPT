import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Attempt, Word } from '../types'
import { GRADE_KEY, GRADE_LABEL } from '../types'
import { grammarById } from '../lib/grammar'
import { fmtMs, fmtTime } from './format'
import { StudyDialog } from './StudyDialog'

export function HistoryDrawer({ log, words, onClose }: { log: Attempt[]; words: Map<string, Word>; onClose: () => void }) {
  const rows = [...log].sort((a, b) => b.seq - a.seq)
  return (
    <StudyDialog title="作答历史" className="history-dialog" onClose={onClose} closeOn={(e) => e.code === 'KeyH'}>
      <p className="muted">{rows.filter((r) => !r.revoked).length} 条有效记录</p>
      {rows.length === 0 && <p className="muted pad">还没有作答记录。</p>}
      <ol className="history">
        {rows.map((a) => {
          const w = words.get(a.wordId)
          return (
            <li key={a.id} className={a.revoked ? 'revoked' : ''}>
              <span className={`chip chip-${a.grade}`}>{a.kind === 'grammar-quiz'
                ? a.grade === 'A' ? '答对' : '答错'
                : `${GRADE_KEY[a.grade]} ${GRADE_LABEL[a.grade]}`}</span>
              <span className="h-word" lang="ja">{(a.subject === 'grammar' ? grammarById.get(a.wordId)?.pattern : w?.word) ?? a.wordId}</span>
              <span className="muted" lang="ja">{a.choice ?? w?.reading}</span>
              <span className="muted h-meta">{fmtMs(a.durationMs)} · {fmtTime(a.answeredAt)}{a.revoked ? ' · 已撤销' : ''}</span>
            </li>
          )
        })}
      </ol>
    </StudyDialog>
  )
}

export function JumpBox({ total, current, grammar, quiz, onJump, onClose }: { total: number; current: number; grammar?: boolean; quiz?: boolean; onJump: (n: number) => void; onClose: () => void }) {
  const [value, setValue] = useState(String(current))
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.select(), [])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = Number(value)
    if (Number.isInteger(n) && n >= 1 && n <= total) onJump(n)
  }
  return (
    <StudyDialog title="跳转题目" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          跳转到第几个（1–{total}）。{quiz ? '已答过的题目会自动跳过。' : `若${grammar ? '该语法点' : '该词'}已评过，会落在其后最近的未评项。`}
          <input ref={input} data-dialog-focus type="number" inputMode="numeric" min={1} max={total} value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <div className="row">
          <button type="submit" className="primary">跳转</button>
          <button type="button" onClick={onClose}>取消</button>
        </div>
      </form>
    </StudyDialog>
  )
}

const SESSION_KEYS: [string, string][] = [
  ['Z / ⌘Z', '撤销上一步'],
  ['P', '暂停 / 继续'],
  ['G', '跳转到指定位置'],
  ['H', '查看本次历史'],
  ['?', '显示或关闭本帮助'],
]

export function HelpSheet({ onClose, grammar, quiz }: { onClose: () => void; grammar?: boolean; quiz?: boolean }) {
  const answerKeys = quiz ? [
    ['A / B / C / D', '选择并提交答案'],
    ['Space', '进入下一题，或从暂停中继续'],
    ['R', '重播正确句（提交答案后）'],
  ] : [
    ['Space', grammar ? '显示目标语法；暂停时继续' : '显示答案并朗读读音；暂停时继续'],
    ...(grammar ? [] : [['R', '重播日语发音（显示答案后）']]),
    ['A', grammar ? '确定掌握：能独立回忆句型、接续和用法' : '确定掌握：读音与词义都能独立回忆'],
    ['S', '模糊记得：只记得部分，或需要联想'],
    ['D', '不认识：想不起来或记错'],
  ]
  return (
    <StudyDialog title="快捷键" onClose={onClose} closeOn={(e) => e.shiftKey && e.code === 'Slash'}>
      <table className="keys">
        <tbody>
          {[...answerKeys, ...SESSION_KEYS].map(([k, d]) => (
            <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>
          ))}
        </tbody>
      </table>
      {!quiz && <p className="muted">先按 Space 核对答案，再评级；评级后自动进入下一项。</p>}
    </StudyDialog>
  )
}
