import { useEffect } from 'react'
import { summarizeBaseline } from '../lib/stats'
import { BookmarkButton } from './BookmarkControls'
import { Card, GradeBar } from './Card'
import { GrammarQuestionCard } from './GrammarQuestionCard'
import { HelpSheet, HistoryDrawer, JumpBox } from './ScanPanels'
import { FRAME_LABEL, SCOPE_LABEL, fmtMs } from './format'
import { useScanSession } from './useScanSession'
import { StudyIcon } from './StudyIcon'

interface Props {
  sessionId: string
  onExit: () => void
  onStats: (sessionId: string) => void
}

export function ScanScreen({ sessionId, onExit, onStats }: Props) {
  const s = useScanSession(sessionId)
  const { session } = s
  const cardPosition = session?.quizFeedback?.wordId ?? session?.order[session.cursor]
  const showingFeedback = !!session?.quizFeedback
  useEffect(() => {
    if (cardPosition && !showingFeedback) window.scrollTo({ top: 0, behavior: 'instant' })
  }, [cardPosition, showingFeedback])
  if (!session) return <p className="muted pad" role="status">{s.msg || '加载中…'}</p>

  const grammar = session.subject === 'grammar'
  const quiz = session.grammarQuiz
  const gradeBar = s.revealed && !s.paused && <div className="study-actions">
    <GradeBar grammar={grammar} enabled={!s.busy && !s.panel} onGrade={s.grade} />
  </div>
  const sum = summarizeBaseline(session, s.baselines)
  const rated = quiz ? s.answers.length : sum.rated
  const correct = s.answers.filter((a) => a.grade === 'A').length
  const position = session.quizFeedback ? session.order.indexOf(session.quizFeedback.wordId) : session.cursor
  const mode = (session.mode === 'sample' ? `随机抽样 n=${session.sampleSize} · 种子 ${session.seed}` : `${quiz ? '全部题目' : '全量普查'} · 种子 ${session.seed}`) + (session.hint === 'example' ? ' · 带例句提示' : '')
  return (
    <div className="scan" data-focused={!s.done ? '' : undefined}>
      <header className="scan-head">
        <button className="link back-link" disabled={s.busy} onClick={onExit}><StudyIcon name="back" /> 练习设置</button>
        <div className="scan-title">
          <strong>{session.wordlistName}</strong>
          {!session.scope.endsWith('-only') && <span className={`badge scope-${session.scope}`}>{SCOPE_LABEL[session.scope]}</span>}
        </div>
        <div className="tally" aria-label="当前计数">
          {quiz ? <>
            <span className="chip chip-A">答对 {correct}</span>
            <span className="chip chip-C">答错 {rated - correct}</span>
          </> : <>
            <span className="chip chip-A">A {sum.counts.A}</span>
            <span className="chip chip-B">B {sum.counts.B}</span>
            <span className="chip chip-C">C {sum.counts.C}</span>
          </>}
        </div>
      </header>
      <div className="session-status">
        <span>{quiz ? '已答' : '已评'} {rated} / {session.sampleSize}{!s.done && ` · 当前第 ${position + 1} ${quiz ? '题' : '位'}`}</span>
        <details>
          <summary>练习详情</summary>
          <p>{mode} · {quiz ? '单选题' : grammar ? '应用语法库' : FRAME_LABEL[session.frameType]}</p>
          <p>有效用时 {fmtMs(session.activeMs)}{session.preRated > 0 && ` · ${session.preRated} ${grammar ? '个语法点' : '词'}沿用既有首评`}</p>
        </details>
      </div>
      <div className="progress" role="progressbar" aria-label={quiz ? '答题进度' : '评级进度'} aria-valuenow={rated} aria-valuemax={session.sampleSize}>
        <div style={{ width: `${rated / session.sampleSize * 100}%` }} />
      </div>
      <div className="keyhints" role="group" aria-label="练习操作">
        <button className="link" disabled={s.busy || s.paused} onClick={s.undo}><kbd>Z</kbd> 撤销</button>
        <button className="link" disabled={s.busy || s.done || !!session.quizFeedback} onClick={s.togglePause}><kbd>P</kbd> {s.paused ? '继续' : '暂停'}</button>
        <button className="link" disabled={s.busy || s.paused || s.done || !!session.quizFeedback} onClick={() => s.setPanel('jump')}><kbd>G</kbd> 跳转</button>
        <button className="link" onClick={() => s.setPanel('history')}><kbd>H</kbd> 历史</button>
        <button className="link keyboard-help" onClick={() => s.setPanel('help')}><kbd>?</kbd> 快捷键</button>
      </div>
      {s.done ? (
        <section className="card done">
          <h1 className="done-title">本次测试完成</h1>
          <p className="muted">{quiz ? `答对 ${correct} / ${rated} 题` : `A ${sum.counts.A} · B ${sum.counts.B} · C ${sum.counts.C}`}</p>
          <div className="row center">
            <button className="primary" onClick={() => onStats(session.id)}>{quiz ? '查看答题明细' : grammar ? '查看掌握报告' : '查看统计'}</button>
            <button onClick={onExit}>返回</button>
          </div>
        </section>
      ) : s.question ? (
        s.paused ? <section className="card" aria-live="polite">
          <div className="card-word">已暂停</div>
          <button className="primary" onClick={s.togglePause}>继续练习 <kbd>Space</kbd></button>
        </section> : <GrammarQuestionCard
          key={session.quizFeedback?.wordId ?? session.order[session.cursor]}
          question={s.question}
          feedback={s.feedback}
          disabled={s.busy || !!s.panel || (!!session.quizFeedback && !s.feedback)}
          last={session.status === 'completed'}
          onChoose={s.choose}
          onNext={s.nextQuestion}
          onSpeak={s.speak}
        />
      ) : s.grammarPoint ? (
        <>
          <section className="card" aria-live="polite">
            {s.paused ? <>
              <div className="card-word">已暂停</div>
              <button className="primary" onClick={s.togglePause}>继续练习 <kbd>Space</kbd></button>
            </> : <>
              <p className="grammar-prompt" lang="ja">{s.grammarPoint.prompt}</p>
              {s.revealed ? <div className="card-answer">
                <span className="muted small">目标语法</span>
                <div className="card-reading grammar-pattern" lang="ja">{s.grammarPoint.pattern}</div>
                <BookmarkButton subject="grammar" itemId={s.grammarPoint.id} label={s.grammarPoint.pattern}
                  disabled={s.busy || !!s.panel} onDialogChange={s.setBookmarkDialogOpen} />
              </div> : <div className="study-actions reveal-actions"><button className="primary" onClick={s.reveal} disabled={!!s.panel}>显示目标语法 <kbd>Space</kbd></button></div>}
            </>}
          </section>
          {gradeBar}
        </>
      ) : s.current ? (
        <>
          <Card key={s.current.id} word={s.current} revealed={s.revealed} masked={s.paused} showExample={session.hint === 'example'}
            onSpeak={s.speak} onReveal={s.reveal} onResume={s.togglePause} disabled={s.busy || !!s.panel}
            onBookmarkDialogChange={s.setBookmarkDialogOpen} />
          {gradeBar}
        </>
      ) : (
        <p className="error">找不到当前{grammar ? '语法点' : '词条'}，请返回后重新打开该会话。</p>
      )}

      {s.msg && <p className="error" role="alert">{s.msg}</p>}

      {s.panel === 'history' && <HistoryDrawer log={s.log} words={s.words} onClose={() => s.setPanel(null)} />}
      {s.panel === 'jump' && <JumpBox total={session.order.length} current={session.cursor + 1} grammar={grammar} quiz={quiz} onJump={s.jump} onClose={() => s.setPanel(null)} />}
      {s.panel === 'help' && <HelpSheet grammar={grammar} quiz={quiz} onClose={() => s.setPanel(null)} />}
    </div>
  )
}
