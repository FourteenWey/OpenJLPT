import { useCallback, useEffect, useRef, useState } from 'react'
import type { Grade, Word, Wordlist } from '../types'
import { GRADE_LABEL } from '../types'
import { selectWordlist } from '../db/builtin'
import { getSetting, putSetting } from '../db/db'
import { getWords, getWordlist, listWordlists } from '../db/wordlists'
import { speakWord, stopSpeaking, ttsEnabled } from '../lib/tts'
import { zhGloss } from '../lib/gloss'
import { BookmarkButton } from './BookmarkControls'
import { GradeBar } from './Card'
import { useApp } from './app-context'
import { useHotkeys } from './hooks'
import { errText } from './useScanSession'
import { StudyIcon } from './StudyIcon'
import { StudyLevelPicker } from './StudyLevelPicker'

interface Rec {
  wordId: string
  grade: Grade
  at: string
}

// 听音识词的成绩单独存在 settings，不写入 attempts / baselines，因此不会混进视觉识词率。
const key = (listId: string) => `listen:${listId}`

/** 每词只取最近一次。 */
function summarize(recs: Rec[]): Record<Grade, number> {
  const last = new Map(recs.map((r) => [r.wordId, r.grade]))
  const c = { A: 0, B: 0, C: 0 }
  for (const g of last.values()) c[g]++
  return c
}

export function ListenScreen({ onBack }: { onBack: () => void }) {
  const { db } = useApp()
  const [lists, setLists] = useState<Wordlist[]>([])
  const [listId, setListId] = useState('')
  const [words, setWords] = useState<Word[]>([])
  const [recs, setRecs] = useState<Rec[]>([])
  const [word, setWord] = useState<Word | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const seen = useRef(new Set<string>())

  const say = useCallback((w: Word) => speakWord(w).catch((e) => setMsg(errText(e))), [])
  const next = useCallback(
    (pool: Word[]) => {
      const left = pool.filter((w) => !seen.current.has(w.id))
      if (!left.length) return setWord(null)
      const w = left[Math.floor(Math.random() * left.length)]
      seen.current.add(w.id)
      setWord(w)
      setRevealed(false)
      setMsg('')
      void say(w)
    },
    [say],
  )

  useEffect(() => {
    listWordlists(db).then((l) => {
      setLists(l)
      setListId(selectWordlist(l)?.id ?? '')
    }).catch((e) => setMsg(errText(e)))
    return stopSpeaking
  }, [db])

  useEffect(() => {
    if (word) window.scrollTo({ top: 0, behavior: 'instant' })
  }, [word])

  const start = async () => {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    try {
      const list = await getWordlist(db, listId)
      if (!list) throw new Error('词表不存在')
      const ws = await getWords(db, list.wordIds)
      seen.current = new Set()
      setWords(ws)
      setRecs((await getSetting<Rec[]>(db, key(listId))) ?? [])
      next(ws)
    } catch (e) {
      setMsg(errText(e))
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  const grade = async (g: Grade) => {
    if (!word || !revealed || saving.current) return
    saving.current = true
    setBusy(true)
    stopSpeaking()
    const all = [...recs, { wordId: word.id, grade: g, at: new Date().toISOString() }]
    try {
      await putSetting(db, key(listId), all)
      setRecs(all)
      next(words)
    } catch (e) {
      setMsg(errText(e))
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  const reveal = () => { if (word && !revealed && !saving.current) setRevealed(true) }
  const backToSetup = () => {
    stopSpeaking()
    setMsg('')
    setWord(null)
    setWords([])
  }
  useHotkeys(
    {
      Space: reveal,
      KeyR: () => word && say(word),
      KeyA: () => grade('A'),
      KeyS: () => grade('B'),
      KeyD: () => grade('C'),
    },
    !!word,
  )

  const sum = summarize(recs)
  const total = sum.A + sum.B + sum.C
  const zh = word ? zhGloss(word) : undefined
  const list = lists.find((item) => item.id === listId)
  return (
    <div className="scan" data-focused={word ? '' : undefined}>
      {!words.length ? (
        <>
          <header className="setup-heading">
            <button className="link back-link" onClick={onBack}><StudyIcon name="back" /> 练习首页</button>
            <h1>听音识词</h1>
            <p>凭读音回想词形与词义，听音成绩单独记录。</p>
          </header>
          <form className="form setup-form block listen-setup" onSubmit={(e) => { e.preventDefault(); void start() }}>
            {list && <StudyLevelPicker lists={lists} selected={list} onChange={setListId} />}
            <button className="primary setup-start" disabled={!listId || busy}>开始听音 <StudyIcon name="arrow" /></button>
          </form>
        </>
      ) : word ? (
        <>
          <header className="scan-head">
            <button className="link back-link" disabled={busy} onClick={backToSetup}><StudyIcon name="back" /> 练习设置</button>
            <strong>听音识词</strong><span className="muted small">本轮第 {seen.current.size} / {words.length} 词</span>
          </header>
          <section className="card" aria-live="polite">
            <div className="card-badge">累计已评 {total} 词 · 听音掌握 {total ? Math.round((sum.A / total) * 100) : 0}%</div>
            {revealed ? (
              <div className="card-answer">
                <div className="card-word" lang="ja">{word.word}</div>
                <div className="card-reading" lang="ja">{word.reading}</div>
                {zh && <div className="card-zh">{zh.text}</div>}
                {word.meanings.length > 0 && <div className="card-en">{word.meanings.join('；')}</div>}
                <BookmarkButton subject="vocabulary" itemId={word.id} label={word.word} disabled={busy} />
              </div>
            ) : (
              <div className="listening-prompt">
                <span className="listening-icon"><StudyIcon name="headphones" /></span>
                <div className="card-hint">听读音，回想对应的词</div>
              </div>
            )}
            <button className="speak" onClick={() => void say(word)}><StudyIcon name="audio" /> 重播 <kbd>R</kbd></button>
            {!ttsEnabled() && <p className="muted small">朗读已关闭，可在「更多」里开启。</p>}
            {!revealed && <div className="study-actions reveal-actions">
              <button className="primary" disabled={busy} onClick={reveal}>显示答案 <kbd>Space</kbd></button>
            </div>}
          </section>
          {revealed && <div className="study-actions"><GradeBar enabled={!busy} onGrade={grade} /></div>}
        </>
      ) : (
        <section className="card done">
          <h1 className="done-title">本轮听完了</h1>
          <p className="muted">A {sum.A} · B {sum.B} · C {sum.C}（{GRADE_LABEL.A}/{GRADE_LABEL.B}/{GRADE_LABEL.C}，每词取最近一次）</p>
          <button onClick={backToSetup}>返回设置</button>
        </section>
      )}
      {msg && <p className="error" role="alert">{msg}</p>}
    </div>
  )
}
