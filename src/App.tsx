import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { openDb, getSetting, putSetting } from './db/db'
import { prepareBuiltinWordlists } from './db/builtin'
import { getSession, setActiveSession } from './db/sessions'
import { GRAMMAR_MIGRATION_KEY, type GrammarMigration } from './db/grammarMigration'
import { setTtsEnabled, stopSpeaking, ttsEnabled } from './lib/tts'
import { AppContext } from './ui/app-context'
import { DataScreen } from './ui/DataScreen'
import { GrammarStatsScreen } from './ui/GrammarStatsScreen'
import { GrammarReviewScreen } from './ui/GrammarReviewScreen'
import { GrammarWrongQuestions } from './ui/GrammarWrongQuestions'
import { StudySubjectSwitch } from './ui/StudySubjectSwitch'
import { ListenScreen } from './ui/ListenScreen'
import { ReviewScreen } from './ui/ReviewScreen'
import { ScanScreen } from './ui/ScanScreen'
import { StartPanel } from './ui/StartPanel'
import { StatsScreen } from './ui/StatsScreen'
import { WrongWords } from './ui/WrongWords'
import { useTheme } from './ui/useTheme'
import { VoiceMenu } from './ui/VoiceMenu'
import { errText } from './ui/useScanSession'
import type { StudySubject } from './types'

type Route = 'scan' | 'grammar' | 'listen' | 'review' | 'stats' | 'words' | 'data'
const TABS: [Route, string][] = [['scan', '单词'], ['grammar', '语法'], ['listen', '听音'], ['review', '复习'], ['stats', '统计'], ['words', '错题'], ['data', '数据']]

export default function App() {
  const [db, setDb] = useState<IDBDatabase | null>(null)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState('')
  const [route, setRoute] = useState<Route>('scan')
  const [subject, setSubject] = useState<StudySubject>('vocabulary')
  const [migration, setMigration] = useState<GrammarMigration>()
  const [runs, setRuns] = useState<Partial<Record<StudySubject, string>>>({})
  const [statsId, setStatsId] = useState<string | undefined>()
  const [grammarReportId, setGrammarReportId] = useState<string | undefined>()
  const [theme, cycleTheme] = useTheme()
  const [tts, setTts] = useState(ttsEnabled)

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
      const restoredRoute = TABS.some(([value]) => value === savedRoute) ? savedRoute : undefined
      if (preferred === 'grammar') setSubject('grammar')
      if (restoredRoute) setRoute(restoredRoute)
      if (active && (active.status !== 'completed' || active.quizFeedback)) {
        setRuns({ [active.subject ?? 'vocabulary']: active.id })
        if (!restoredRoute) {
          setSubject(active.subject ?? 'vocabulary')
          if (active.subject === 'grammar') setRoute('grammar')
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
    void putSetting(ctx.db, 'activeRoute', value)
  }

  const go = (r: Route) => (e: MouseEvent<HTMLElement>) => {
    e.currentTarget.blur()
    if (r === 'scan' || r === 'listen') selectSubject('vocabulary')
    if (r === 'grammar') selectSubject('grammar')
    const id = r === 'scan' ? runs.vocabulary : r === 'grammar' ? runs.grammar : undefined
    if (id) void setActiveSession(ctx.db, id)
    navigate(r)
  }
  const toggleTts = (e: MouseEvent<HTMLElement>) => {
    e.currentTarget.blur()
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

  return (
    <AppContext.Provider value={ctx}>
      <nav className="topbar" aria-label="主导航">
        <strong className="brand">JLPT 快筛</strong>
        {TABS.map(([r, label]) => {
          const selected = route === r
          return <button key={r} className={selected ? 'tab active' : 'tab'} aria-current={selected} tabIndex={-1} onClick={go(r)}>{label}</button>
        })}
        <button className="tab right" tabIndex={-1} onClick={toggleTts} title="单词显示答案时朗读读音；语法提交答案后朗读正确句；R 重播">朗读：{tts ? '开' : '关'}</button>
        <VoiceMenu tts={tts} />
        <button className="tab right" tabIndex={-1} onClick={(e) => { e.currentTarget.blur(); cycleTheme() }} title="切换主题">主题：{theme}</button>
      </nav>
      <main>
        {migration?.noticePending && <div className="notice migration-notice" role="status">
          <span>已将 {migration.count} 个历史语法错题补入复习队列，从升级当天开始复习。</span>
          <button onClick={() => {
            const next = { ...migration, noticePending: false }
            void putSetting(ctx.db, GRAMMAR_MIGRATION_KEY, next).then(() => setMigration(next))
          }}>知道了</button>
        </div>}
        {(['review', 'stats', 'words', 'data'] as Route[]).includes(route) && <StudySubjectSwitch subject={subject} onChange={selectSubject} />}
        {route === 'scan' && (runs.vocabulary
          ? <ScanScreen key={runs.vocabulary} sessionId={runs.vocabulary} onExit={exit('vocabulary')} onStats={showStats} />
          : <StartPanel key="vocabulary" onOpen={open('vocabulary')} onStats={showStats} />)}
        {route === 'grammar' && (runs.grammar
          ? <ScanScreen key={runs.grammar} sessionId={runs.grammar} onExit={exit('grammar')} onStats={showGrammarReport} />
          : <StartPanel key="grammar" subject="grammar" onOpen={open('grammar')} onStats={showGrammarReport} onGrammarReport={() => showGrammarReport()}
            onGrammarLibrary={() => { selectSubject('grammar'); navigate('data') }} />)}
        {route === 'listen' && <ListenScreen />}
        {route === 'review' && (subject === 'grammar' ? <GrammarReviewScreen /> : <ReviewScreen />)}
        {route === 'stats' && (subject === 'grammar' ? <GrammarStatsScreen key={grammarReportId ?? 'grammar-stats'} initialId={grammarReportId} /> : <StatsScreen initialId={statsId} />)}
        {route === 'words' && (subject === 'grammar' ? <GrammarWrongQuestions onReview={() => navigate('review')} /> : <WrongWords />)}
        {route === 'data' && <DataScreen key={subject} subject={subject} />}
      </main>
      {route !== 'scan' && route !== 'grammar' && route !== 'listen' && route !== 'review' && <footer className="credit">题库与词表来源详见「数据」页。</footer>}
    </AppContext.Provider>
  )
}
