import type { MouseEvent } from 'react'
import { summarizeBaseline } from '../lib/stats'
import { Card, GradeBar } from './Card'
import { HelpSheet, HistoryDrawer, JumpBox } from './ScanPanels'
import { FRAME_LABEL, SCOPE_LABEL, fmtMs } from './format'
import { useScanSession } from './useScanSession'

interface Props {
  sessionId: string
  onExit: () => void
  onStats: (sessionId: string) => void
}

/** 鼠标点击后移除焦点，避免之后按 Space 再次触发该按钮。 */
const click = (fn: () => unknown) => (e: MouseEvent<HTMLElement>) => {
  e.currentTarget.blur()
  fn()
}

export function ScanScreen({ sessionId, onExit, onStats }: Props) {
  const s = useScanSession(sessionId)
  const { session } = s
  if (!session) return <p className="muted pad" role="status">{s.msg || '加载中…'}</p>

  const sum = summarizeBaseline(session, s.baselines)
  const mode = (session.mode === 'sample' ? `随机抽样 n=${session.sampleSize} · 种子 ${session.seed}` : `全量普查 · 种子 ${session.seed}`) + (session.hint === 'example' ? ' · 带例句提示' : '')
  return (
    <div className="scan">
      <header className="scan-head">
        <button className="link" tabIndex={-1} onClick={click(onExit)}>← 会话列表</button>
        <div className="scan-title">
          <strong>{session.wordlistName}</strong>
          <span className={`badge scope-${session.scope}`}>{SCOPE_LABEL[session.scope]}</span>
          <span className="muted small">{mode} · {FRAME_LABEL[session.frameType]}</span>
        </div>
        <div className="tally" aria-label="当前计数">
          <span className="chip chip-A">A {sum.counts.A}</span>
          <span className="chip chip-B">B {sum.counts.B}</span>
          <span className="chip chip-C">C {sum.counts.C}</span>
        </div>
      </header>
      <div className="progress" role="progressbar" aria-valuenow={sum.rated} aria-valuemax={session.sampleSize}>
        <div style={{ width: `${sum.completion * 100}%` }} />
      </div>
      <p className="muted small center">
        已评 {sum.rated} / {session.sampleSize} · 当前第 {session.cursor + 1} 位 · 有效用时 {fmtMs(session.activeMs)}
        {session.preRated > 0 && ` · 其中 ${session.preRated} 词沿用既有首评`}
      </p>

      {s.done ? (
        <section className="card done">
          <div className="card-word">本次测试完成</div>
          <p className="muted">A {sum.counts.A} · B {sum.counts.B} · C {sum.counts.C}</p>
          <div className="row center">
            <button className="primary" onClick={() => onStats(session.id)}>查看统计</button>
            <button onClick={onExit}>返回</button>
          </div>
        </section>
      ) : s.current ? (
        <>
          <Card word={s.current} revealed={s.revealed} masked={s.paused} showExample={session.hint === 'example'} onSpeak={s.speak} />
          <GradeBar enabled={s.revealed && !s.paused && !s.busy && !s.panel} onGrade={s.grade} />
        </>
      ) : (
        <p className="error">找不到当前词条，请返回后重新打开该会话。</p>
      )}

      {s.msg && <p className="error" role="alert">{s.msg}</p>}
      <footer className="keyhints">
        <button className="link" tabIndex={-1} onClick={click(s.undo)}><kbd>Z</kbd> 撤销</button>
        <button className="link" tabIndex={-1} onClick={click(s.togglePause)}><kbd>P</kbd> {s.paused ? '继续' : '暂停'}</button>
        <button className="link" tabIndex={-1} onClick={click(() => s.setPanel('jump'))}><kbd>G</kbd> 跳转</button>
        <button className="link" tabIndex={-1} onClick={click(() => s.setPanel(s.panel === 'history' ? null : 'history'))}><kbd>H</kbd> 历史</button>
        <button className="link" tabIndex={-1} onClick={click(() => s.setPanel(s.panel === 'help' ? null : 'help'))}><kbd>?</kbd> 帮助</button>
      </footer>

      {s.panel === 'history' && <HistoryDrawer log={s.log} words={s.words} onClose={() => s.setPanel(null)} />}
      {s.panel === 'jump' && <JumpBox total={session.order.length} current={session.cursor + 1} onJump={s.jump} onClose={() => s.setPanel(null)} />}
      {s.panel === 'help' && <HelpSheet onClose={() => s.setPanel(null)} />}
    </div>
  )
}
