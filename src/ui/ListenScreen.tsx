import { useCallback, useEffect, useRef, useState } from 'react'
import type { Grade, Word, Wordlist } from '../types'
import { GRADE_LABEL } from '../types'
import { selectWordlist } from '../db/builtin'
import { getSetting, putSetting } from '../db/db'
import { getWords, getWordlist, listWordlists } from '../db/wordlists'
import { speakWord, stopSpeaking } from '../lib/tts'
import { zhGloss } from '../lib/gloss'
import { GradeBar } from './Card'
import { useApp } from './app-context'
import { useHotkeys } from './hooks'
import { errText } from './useScanSession'

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

/** 听音识词：只播放读音，不显示词形；Space 后看词形与释义，再自评。 */
export function ListenScreen() {
  const { db } = useApp()
  const [lists, setLists] = useState<Wordlist[]>([])
  const [listId, setListId] = useState('')
  const [words, setWords] = useState<Word[]>([])
  const [recs, setRecs] = useState<Rec[]>([])
  const [word, setWord] = useState<Word | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [msg, setMsg] = useState('')
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

  const start = async () => {
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
    }
  }

  const grade = async (g: Grade) => {
    if (!word || !revealed) return
    stopSpeaking()
    const all = [...recs, { wordId: word.id, grade: g, at: new Date().toISOString() }]
    try {
      await putSetting(db, key(listId), all)
      setRecs(all)
      next(words)
    } catch (e) {
      setMsg(errText(e))
    }
  }

  useHotkeys(
    {
      Space: () => word && !revealed && setRevealed(true),
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
  return (
    <div className="scan">
      <header className="scan-head">
        <strong>听音识词</strong>
        <span className="muted small">只听读音，凭听觉回忆词形与词义。成绩单独统计，不计入视觉识词率。</span>
      </header>
      {!words.length ? (
        <div className="row">
          <label>词表<select value={listId} onChange={(e) => setListId(e.target.value)}>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <button className="primary" onClick={start} disabled={!listId}>开始听音</button>
        </div>
      ) : word ? (
        <>
          <section className="card" aria-live="polite">
            <div className="card-badge">听音识词 · 已评 {total} 词 · 听音掌握 {total ? Math.round((sum.A / total) * 100) : 0}%</div>
            {revealed ? (
              <div className="card-answer">
                <div className="card-word" lang="ja">{word.word}</div>
                <div className="card-reading" lang="ja">{word.reading}</div>
                {zh && <div className="card-zh">{zh.text}</div>}
                {word.meanings.length > 0 && <div className="card-en">{word.meanings.join('；')}</div>}
              </div>
            ) : (
              <div className="card-hint">听读音，回忆是哪个词。<kbd>R</kbd> 重播 · <kbd>Space</kbd> 显示答案</div>
            )}
            <button className="speak" tabIndex={-1} onClick={(e) => { e.currentTarget.blur(); void say(word) }}>▶ 重播 <kbd>R</kbd></button>
          </section>
          <GradeBar enabled={revealed} onGrade={grade} />
        </>
      ) : (
        <section className="card done">
          <div className="card-word">本轮听完了</div>
          <p className="muted">A {sum.A} · B {sum.B} · C {sum.C}（{GRADE_LABEL.A}/{GRADE_LABEL.B}/{GRADE_LABEL.C}，每词取最近一次）</p>
          <button onClick={() => setWords([])}>返回</button>
        </section>
      )}
      {msg && <p className="error" role="alert">{msg}</p>}
    </div>
  )
}
