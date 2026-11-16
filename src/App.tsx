import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { openDb, getSetting, putSetting } from './db/db'
import { ensureBuiltin, refreshBuiltinWords } from './db/builtin'
import { getSession, setActiveSession } from './db/sessions'
import { listWordlists } from './db/wordlists'
import { applyGeneratedZh } from './db/zh'
import { setTtsEnabled, stopSpeaking, ttsEnabled } from './lib/tts'
import { AppContext } from './ui/app-context'
import { DataScreen } from './ui/DataScreen'
import { ListenScreen } from './ui/ListenScreen'
import { ReviewScreen } from './ui/ReviewScreen'
import { ScanScreen } from './ui/ScanScreen'
import { StartPanel } from './ui/StartPanel'
import { StatsScreen } from './ui/StatsScreen'
import { WrongWords } from './ui/WrongWords'
import { useTheme } from './ui/useTheme'
import { VoiceMenu } from './ui/VoiceMenu'
import { errText } from './ui/useScanSession'

type Route = 'scan' | 'listen' | 'review' | 'stats' | 'words' | 'data'
const TABS: [Route, string][] = [['scan', '快筛'], ['listen', '听音'], ['review', '复习'], ['stats', '统计'], ['words', '错词'], ['data', '数据']]

export default function App() {
  const [db, setDb] = useState<IDBDatabase | null>(null)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState('')
  const [route, setRoute] = useState<Route>('scan')
  const [runId, setRunId] = useState<string | null>(null)
  const [statsId, setStatsId] = useState<string | undefined>()
  const [theme, cycleTheme] = useTheme()
  const [tts, setTts] = useState(ttsEnabled)

  useEffect(() => {
    let opened: IDBDatabase | undefined
    ;(async () => {
      const d = await openDb()
      opened = d
      if (!(await listWordlists(d)).length) await ensureBuiltin(d, 'n3')
      await refreshBuiltinWords(d).catch(() => 0)
      await applyGeneratedZh(d)
      const activeId = await getSetting<string>(d, 'activeSessionId')
      const active = activeId ? await getSession(d, activeId) : undefined
      if (active && active.status !== 'completed') setRunId(active.id)
      setDb(d)
    })().catch((e) => setError(`无法初始化本地数据库：${errText(e)}`))
    return () => opened?.close()
  }, [])

  const bump = useCallback(() => setVersion((v) => v + 1), [])
  const ctx = useMemo(() => (db ? { db, version, bump } : null), [db, version, bump])

  if (error) return <p className="error pad" role="alert">{error}</p>
  if (!ctx) return <p className="muted pad" role="status">正在准备本地数据…</p>

  const go = (r: Route) => (e: MouseEvent<HTMLElement>) => {
    e.currentTarget.blur()
    setRoute(r)
  }
  const toggleTts = (e: MouseEvent<HTMLElement>) => {
    e.currentTarget.blur()
    if (tts) stopSpeaking()
    setTtsEnabled(!tts)
    setTts(!tts)
  }
  const open = (id: string) => {
    void setActiveSession(ctx.db, id)
    setRunId(id)
    setRoute('scan')
  }
  const exit = () => {
    void putSetting(ctx.db, 'activeSessionId', '')
    setRunId(null)
    bump()
  }

  return (
    <AppContext.Provider value={ctx}>
      <nav className="topbar" aria-label="主导航">
        <strong className="brand">JLPT 词汇快筛</strong>
        {TABS.map(([r, label]) => (
          <button key={r} className={route === r ? 'tab active' : 'tab'} aria-current={route === r} tabIndex={-1} onClick={go(r)}>{label}</button>
        ))}
        <button className="tab right" tabIndex={-1} onClick={toggleTts} title="按 Space 显示答案时朗读读音；R 重播">朗读：{tts ? '开' : '关'}</button>
        <VoiceMenu tts={tts} />
        <button className="tab right" tabIndex={-1} onClick={(e) => { e.currentTarget.blur(); cycleTheme() }} title="切换主题">主题：{theme}</button>
      </nav>
      <main>
        {route === 'scan' && (runId ? <ScanScreen sessionId={runId} onExit={exit} onStats={(id) => { setStatsId(id); setRoute('stats') }} /> : <StartPanel onOpen={open} onStats={(id) => { setStatsId(id); setRoute('stats') }} />)}
        {route === 'listen' && <ListenScreen />}
        {route === 'review' && <ReviewScreen />}
        {route === 'stats' && <StatsScreen initialId={statsId} />}
        {route === 'words' && <WrongWords />}
        {route === 'data' && <DataScreen />}
      </main>
      {route !== 'scan' && route !== 'listen' && route !== 'review' && <footer className="credit">词表来自 OpenJLPT（CC BY-SA 4.0），详见「数据」页。</footer>}
    </AppContext.Provider>
  )
}
