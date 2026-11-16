import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Attempt, Word } from '../types'
import { GRADE_KEY, GRADE_LABEL } from '../types'
import { fmtMs, fmtTime } from './format'

export function HistoryDrawer({ log, words, onClose }: { log: Attempt[]; words: Map<string, Word>; onClose: () => void }) {
  const rows = [...log].sort((a, b) => b.seq - a.seq)
  return (
    <aside className="drawer" aria-label="作答历史">
      <header>
        <strong>作答历史</strong>
        <span className="muted">{rows.filter((r) => !r.revoked).length} 条有效</span>
        <button className="link" onClick={onClose}>关闭 (Esc)</button>
      </header>
      {rows.length === 0 && <p className="muted pad">还没有作答记录。</p>}
      <ol className="history">
        {rows.map((a) => {
          const w = words.get(a.wordId)
          return (
            <li key={a.id} className={a.revoked ? 'revoked' : ''}>
              <span className={`chip chip-${a.grade}`}>{GRADE_KEY[a.grade]} {GRADE_LABEL[a.grade]}</span>
              <span className="h-word" lang="ja">{w?.word ?? a.wordId}</span>
              <span className="muted" lang="ja">{w?.reading}</span>
              <span className="muted h-meta">{fmtMs(a.durationMs)} · {fmtTime(a.answeredAt)}{a.revoked ? ' · 已撤销' : ''}</span>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}

export function JumpBox({ total, current, onJump, onClose }: { total: number; current: number; onJump: (n: number) => void; onClose: () => void }) {
  const [value, setValue] = useState(String(current))
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.select(), [])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = Number(value)
    if (Number.isInteger(n) && n >= 1 && n <= total) onJump(n)
  }
  return (
    <form className="modal" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <label>
        跳转到第几个（1–{total}）。若该词已评过，会落在其后最近的未评词。
        <input ref={input} type="number" min={1} max={total} value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <div className="row">
        <button type="submit" className="primary">跳转 (Enter)</button>
        <button type="button" onClick={onClose}>取消 (Esc)</button>
      </div>
    </form>
  )
}

const KEYS: [string, string][] = [
  ['Space', '显示答案并朗读读音；暂停时继续'],
  ['R', '重播日语发音（显示答案后）'],
  ['A', '确定掌握：读音与词义都能独立回忆'],
  ['S', '模糊记得：只记得部分，或需要联想'],
  ['D', '不认识：想不起来或记错'],
  ['Z / ⌘Z', '撤销上一步'],
  ['P', '暂停 / 继续'],
  ['G', '跳转到指定位置'],
  ['H', '查看本次历史'],
  ['?', '显示或关闭本帮助'],
]

export function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal" role="dialog" aria-label="快捷键">
      <table className="keys">
        <tbody>
          {KEYS.map(([k, d]) => (
            <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="muted">先按 Space 核对答案，再评级；评级后自动进入下一词。</p>
      <button onClick={onClose}>关闭 (Esc)</button>
    </div>
  )
}
