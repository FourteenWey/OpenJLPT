import type { Session, StudySubject } from '../types'
import { listSessions } from '../db/sessions'
import { dueItems } from '../db/review'
import { useApp } from './app-context'
import { useLoad } from './useLoad'
import { StudyIcon } from './StudyIcon'

export type PracticeMode = 'scan' | 'grammar' | 'listen'

const modes = [
  { id: 'scan', title: '单词快筛', description: '看词形，回想读音和词义。', glyph: '語', kind: 'vocab' },
  { id: 'grammar', title: '语法速筛', description: '选出合适的表达，核对用法。', glyph: '文', kind: 'grammar' },
  { id: 'listen', title: '听音识词', description: '只听日语读音，回想对应的词。', glyph: null, kind: 'listen' },
] as const

export function PracticeHome({ onMode, onResume, onReview }: {
  onMode: (mode: PracticeMode) => void
  onResume: (session: Session) => void
  onReview: (subject?: StudySubject) => void
}) {
  const { db, version } = useApp()
  const { data } = useLoad(async () => {
    const [sessions, words, grammar] = await Promise.all([
      listSessions(db), dueItems(db), dueItems(db, new Date(), 'grammar'),
    ])
    const recent = sessions
      .filter((s) => s.status !== 'completed' || s.quizFeedback)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    return { recent, words: words.length, grammar: grammar.length }
  }, [db, version])
  const recent = data?.recent

  return <div className="practice-home">
    <header className="practice-hero">
      <div className="hero-copy">
        <p className="hero-levels"><span /> JLPT N5–N1</p>
        <h1>今天练点日语<span>。</span></h1>
        <p>从单词、语法和听音里，找出还需要巩固的地方。</p>
      </div>
      <div className="hero-art" aria-hidden="true">
        <div className="hero-sun" />
        <div className="hero-paper hero-paper-back"><span lang="ja">文</span></div>
        <div className="hero-paper hero-paper-front"><span lang="ja">あ</span><i /></div>
      </div>
    </header>
    <section aria-labelledby="practice-choices">
      <h2 className="section-title" id="practice-choices">开始练习</h2>
      <div className="practice-grid">
        {modes.map(({ id, title, description, glyph, kind }) => <button key={id} type="button" className={`practice-tile tile-${kind}`}
          aria-label={title} aria-describedby={`mode-${id}-description`} onClick={() => onMode(id)}>
          <span className="tile-mark" aria-hidden="true">{glyph ? <span lang="ja">{glyph}</span> : <StudyIcon name="headphones" />}</span>
          <span className="tile-copy"><strong>{title}</strong><span id={`mode-${id}-description`}>{description}</span></span>
          <span className="tile-arrow"><StudyIcon name="arrow" /></span>
        </button>)}
      </div>
    </section>
    {data && <div className="home-followups">
      {recent && <button className="home-note" onClick={() => onResume(recent)}>
        <StudyIcon name="book" /><span><strong>继续上次练习</strong><small>{recent.wordlistName} · {recent.quizFeedback ? '查看上一题解析' : `${recent.sampleSize} ${recent.subject === 'grammar' ? '题' : '词'}`}</small></span><StudyIcon name="arrow" />
      </button>}
      <button className="home-note" onClick={() => onReview(data.words && data.grammar ? undefined : data.grammar ? 'grammar' : data.words ? 'vocabulary' : undefined)}>
        <StudyIcon name="review" /><span><strong>今日复习</strong><small>{data.words || data.grammar ? `${data.words} 个单词 · ${data.grammar} 道语法题到期` : '今天暂无到期内容'}</small></span><StudyIcon name="arrow" />
      </button>
    </div>}
  </div>
}
