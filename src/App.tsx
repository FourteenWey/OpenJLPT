import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { openDb, getSetting, putSetting } from './db/db'
import { prepareBuiltinWordlists } from './db/builtin'
import { getSession, setActiveSession } from './db/sessions'
import { GRAMMAR_MIGRATION_KEY, type GrammarMigration } from './db/grammarMigration'
import { setTtsEnabled, stopSpeaking, ttsEnabled } from './lib/tts'
import { AppContext } from './ui/app-context'
import { BookmarksScreen } from './ui/BookmarksScreen'
import { DataScreen } from './ui/DataScreen'
import { GrammarStatsScreen } from './ui/GrammarStatsScreen'
import { GrammarReviewScreen } from './ui/GrammarReviewScreen'
import { GrammarWrongQuestions } from './ui/GrammarWrongQuestions'
import { StudySubjectSwitch } from './ui/StudySubjectSwitch'
import { ListenScreen } from './ui/ListenScreen'
import { PracticeHome, type PracticeMode } from './ui/PracticeHome'
import { ReviewScreen } from './ui/ReviewScreen'
import { ScanScreen } from './ui/ScanScreen'
import { StartPanel } from './ui/StartPanel'
import { StatsScreen } from './ui/StatsScreen'
import { StudyDialog } from './ui/StudyDialog'
import { StudyIcon } from './ui/StudyIcon'
import { useStudyFullscreen } from './ui/useStudyFullscreen'
import { WrongWords } from './ui/WrongWords'
import { THEMES, useTheme } from './ui/useTheme'
import { VoiceSettings } from './ui/VoiceMenu'
import { errText } from './ui/useScanSession'
import type { StudySubject } from './types'

type Route = 'practice' | PracticeMode | 'review' | 'stats' | 'words' | 'bookmarks' | 'data'
const ROUTES: Route[] = ['practice', 'scan', 'grammar', 'listen', 'review', 'stats', 'words', 'bookmarks', 'data']
const FULLSCREEN_ACTIONS = {
  enter: { label: '进入全屏', description: '全屏显示练习，收起站内导航' },
  fullscreen: { label: '退出全屏', description: '还原浏览器窗口，也可按 Esc 退出' },
  fallback: { label: '进入沉浸模式', description: '收起答题导航，保留浏览器工具栏' },
  immersive: { label: '退出沉浸模式', description: '恢复常规答题布局' },
}

export default function App() {
  const [db, setDb] = useState<IDBDatabase | null>(null)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState('')
  const [route, setRoute] = useState<Route>('practice')
  const [subject, setSubject] = useState<StudySubject>('vocabulary')
  const [migration, setMigration] = useState<GrammarMigration>()
  const [runs, setRuns] = useState<Partial<Record<StudySubject, string>>>({})
  const [statsId, setStatsId] = useState<string | undefined>()
  const [grammarReportId, setGrammarReportId] = useState<string | undefined>()
  const [theme, setTheme] = useTheme()
  const [tts, setTts] = useState(ttsEnabled)
  const [more, setMore] = useState(false)
  const [fullscreenError, setFullscreenError] = useState(false)
  const fullscreen = useStudyFullscreen()
  const main = useRef<HTMLElement>(null)

  useEffect(() => {
    let opened: IDBDatabase | undefined
    ;(async () => {
      const d = await openDb()
      opened = d
      await prepareBuiltinWordlists(d)
      const activeId = await getSetting<string>(d, 'activeSessionId')
      const active = activeId ? await getSession(d, activeId) : undefined
      const preferred = await getSetting<StudySubject>(d, 'activeStudySubject')
      const savedRoute = await getSetting<Route>(d, 'activeRoute')
      const restoredRoute = savedRoute && ROUTES.includes(savedRoute) ? savedRoute : undefined
      if (preferred === 'grammar') setSubject('grammar')
      if (restoredRoute) setRoute(restoredRoute)
      if (active && (active.status !== 'completed' || active.quizFeedback)) {
        setRuns({ [active.subject ?? 'vocabulary']: active.id })
        if (!restoredRoute) {
          setSubject(active.subject ?? 'vocabulary')
          setRoute(active.subject === 'grammar' ? 'grammar' : 'scan')
        }
      }
      if (restoredRoute === 'grammar') setSubject('grammar')
      if (restoredRoute === 'scan' || restoredRoute === 'listen') setSubject('vocabulary')
      setDb(d)
    })().catch((e) => setError(`无法初始化本地数据库：${errText(e)}`))
    return () => opened?.close()
  }, [])

  useEffect(() => {
    if (!db) return
    let alive = true
    void getSetting<GrammarMigration>(db, GRAMMAR_MIGRATION_KEY).then((value) => { if (alive) setMigration(value) }).catch(() => {})
    return () => { alive = false }
  }, [db, version])

  const bump = useCallback(() => setVersion((v) => v + 1), [])
  const ctx = useMemo(() => (db ? { db, version, bump } : null), [db, version, bump])

  if (error) return <p className="error pad" role="alert">{error}</p>
  if (!ctx) return <p className="muted pad" role="status">正在准备本地数据…</p>

  const selectSubject = (value: StudySubject) => {
    stopSpeaking()
    setSubject(value)
    void putSetting(ctx.db, 'activeStudySubject', value)
  }
  const navigate = (value: Route) => {
    stopSpeaking()
    setRoute(value)
    setMore(false)
    void putSetting(ctx.db, 'activeRoute', value)
    window.scrollTo({ top: 0, behavior: 'instant' })
    requestAnimationFrame(() => main.current?.focus({ preventScroll: true }))
  }
  const configure = (mode: PracticeMode) => {
    const value = mode === 'grammar' ? 'grammar' : 'vocabulary'
    selectSubject(value)
    if (mode !== 'listen') {
      setRuns((current) => ({ ...current, [value]: undefined }))
      void putSetting(ctx.db, 'activeSessionId', '')
    }
    navigate(mode)
  }
  const openMore = (e: MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.focus()
    setFullscreenError(false)
    setMore(true)
  }
  const toggleFullscreen = async () => {
    const changed = await fullscreen.toggle()
    if (changed === undefined) return
    if (!changed) {
      setFullscreenError(true)
      return
    }
    setMore(false)
    requestAnimationFrame(() => main.current?.focus({ preventScroll: true }))
  }
  const toggleTts = () => {
    if (tts) stopSpeaking()
    setTtsEnabled(!tts)
    setTts(!tts)
  }
  const open = (subject: StudySubject) => (id: string) => {
    selectSubject(subject)
    void setActiveSession(ctx.db, id)
    setRuns((current) => ({ ...current, [subject]: id }))
    navigate(subject === 'grammar' ? 'grammar' : 'scan')
  }
  const exit = (subject: StudySubject) => () => {
    void putSetting(ctx.db, 'activeSessionId', '')
    setRuns((current) => ({ ...current, [subject]: undefined }))
    bump()
    navigate(subject === 'grammar' ? 'grammar' : 'scan')
  }
  const showStats = (id: string) => {
    selectSubject('vocabulary')
    setStatsId(id)
    navigate('stats')
  }
  const showGrammarReport = (id?: string) => {
    selectSubject('grammar')
    setGrammarReportId(id)
    navigate('stats')
  }
  const records = route === 'stats' || route === 'words' || route === 'bookmarks'
  const practice = route === 'practice' || route === 'scan' || route === 'grammar' || route === 'listen'
  const backToPractice = () => navigate('practice')
  const fullscreenAction = FULLSCREEN_ACTIONS[fullscreen.mode ?? (fullscreen.supportsFullscreen ? 'enter' : 'fallback')]

  return (
    <AppContext.Provider value={ctx}>
      <header className="app-header" data-immersive={fullscreen.mode ?? undefined}>
        <div className="header-inner">
          <button className="brand" onClick={backToPractice}>
            <span className="brand-mark"><StudyIcon name="book" /></span>
            <strong>JLPT <span>快筛</span></strong>
          </button>
          <nav className="main-nav" aria-label="主导航">
            <button aria-current={practice ? 'page' : undefined} onClick={backToPractice}><StudyIcon name="book" />练习</button>
            <button aria-current={route === 'review' ? 'page' : undefined} onClick={() => navigate('review')}><StudyIcon name="review" />复习</button>
            <button aria-current={records ? 'page' : undefined} onClick={() => { if (!records) navigate('stats') }}><StudyIcon name="records" />记录</button>
            <button aria-current={route === 'data' ? 'page' : undefined} aria-haspopup="dialog" onClick={openMore}><StudyIcon name="more" />更多</button>
          </nav>
          <button className="icon-button focused-more" aria-label="更多设置" aria-haspopup="dialog" onClick={openMore}><StudyIcon name="more" /></button>
        </div>
      </header>
      <main ref={main} tabIndex={-1} className={route === 'practice' ? 'home-main' : undefined}>
        {migration?.noticePending && <div className="notice migration-notice" role="status">
          <span>已将 {migration.count} 个历史语法错题补入复习队列，从升级当天开始复习。</span>
          <button onClick={() => {
            const next = { ...migration, noticePending: false }
            void putSetting(ctx.db, GRAMMAR_MIGRATION_KEY, next).then(() => setMigration(next))
          }}>知道了</button>
        </div>}
        {route === 'practice' && <PracticeHome onMode={configure} onResume={(session) => open(session.subject ?? 'vocabulary')(session.id)}
          onReview={(value) => { if (value) selectSubject(value); navigate('review') }} />}
        {(records || route === 'review' || route === 'data') && <header className={route === 'review' ? 'page-heading scan-width' : 'page-heading'}>
          {route === 'review' && <button className="link back-link review-back" onClick={backToPractice}><StudyIcon name="back" /> 练习首页</button>}
          <div className="page-heading-title">
            <h1>{records ? '学习记录' : route === 'review' ? '今日复习' : '词表与题库'}</h1>
            <StudySubjectSwitch subject={subject} onChange={selectSubject} />
          </div>
          {records && <nav className="record-nav" aria-label="记录类型">
            <button aria-current={route === 'stats' ? 'page' : undefined} onClick={() => navigate('stats')}>统计</button>
            <button aria-current={route === 'words' ? 'page' : undefined} onClick={() => navigate('words')}>错题</button>
            <button aria-current={route === 'bookmarks' ? 'page' : undefined} onClick={() => navigate('bookmarks')}>书签</button>
          </nav>}
        </header>}
        {route === 'scan' && (runs.vocabulary
          ? <ScanScreen key={runs.vocabulary} sessionId={runs.vocabulary} onExit={exit('vocabulary')} onStats={showStats} />
          : <StartPanel key="vocabulary" onBack={backToPractice} onOpen={open('vocabulary')} onStats={showStats} />)}
        {route === 'grammar' && (runs.grammar
          ? <ScanScreen key={runs.grammar} sessionId={runs.grammar} onExit={exit('grammar')} onStats={showGrammarReport} />
          : <StartPanel key="grammar" subject="grammar" onBack={backToPractice} onOpen={open('grammar')} onStats={showGrammarReport} onGrammarReport={() => showGrammarReport()}
            onGrammarLibrary={() => { selectSubject('grammar'); navigate('data') }} />)}
        {route === 'listen' && <ListenScreen onBack={backToPractice} />}
        {route === 'review' && (subject === 'grammar' ? <GrammarReviewScreen /> : <ReviewScreen />)}
        {route === 'stats' && (subject === 'grammar' ? <GrammarStatsScreen key={grammarReportId ?? 'grammar-stats'} initialId={grammarReportId} /> : <StatsScreen key={statsId ?? 'vocabulary-stats'} initialId={statsId} />)}
        {route === 'words' && (subject === 'grammar' ? <GrammarWrongQuestions onReview={() => navigate('review')} /> : <WrongWords />)}
        {route === 'bookmarks' && <BookmarksScreen key={subject} subject={subject} />}
        {route === 'data' && <DataScreen key={subject} subject={subject} />}
      </main>
      {records && <footer className="credit">题库与词表来源详见「词表与题库」。</footer>}
      {more && <StudyDialog title="更多" className="more-dialog" onClose={() => setMore(false)}>
        <button className="settings-link" onClick={toggleFullscreen}>
          <StudyIcon name={fullscreen.mode ? 'exitFullscreen' : 'fullscreen'} />
          <span><strong>{fullscreenAction.label}</strong><small>{fullscreenAction.description}</small></span>
        </button>
        {fullscreenError && <p className="error small" role="status">浏览器暂时无法退出全屏，可按 Esc 退出。</p>}
        <button className="settings-link" onClick={() => navigate('data')}><StudyIcon name="records" /><span><strong>词表与题库</strong><small>浏览、导入与备份恢复</small></span><StudyIcon name="arrow" /></button>
        <section className="settings-section">
          <h3>朗读</h3>
          <button className="tts-toggle" role="switch" aria-checked={tts} onClick={toggleTts}>
            <span>开启朗读</span><span className="switch-indicator" aria-hidden="true" />
          </button>
          <VoiceSettings tts={tts} />
        </section>
        <section className="settings-section settings-fields">
          <label>外观<select value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}>
            {Object.entries(THEMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        </section>
      </StudyDialog>}
    </AppContext.Provider>
  )
}
