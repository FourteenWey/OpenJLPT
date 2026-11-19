import { useState } from 'react'
import type { Word } from '../types'
import { moraCount } from '../lib/kana'
import { getOverride, resolvePronunciation, setOverride } from '../lib/pronunciation'

interface Props {
  word: Word
  onSpeak: () => void
}

/** 发音按钮、读音/重音状态，以及手动纠正入口。重音没有权威资料时标「待校验」，不自行编造。 */
export function PronPanel({ word, onSpeak }: Props) {
  const [, tick] = useState(0)
  const [editing, setEditing] = useState(false)
  const [reading, setReading] = useState('')
  const [accent, setAccent] = useState('')
  const [err, setErr] = useState('')
  const p = resolvePronunciation(word)

  const open = () => {
    const o = getOverride(word.id)
    setReading(o?.reading ?? word.reading)
    setAccent(o?.accent === undefined ? '' : String(o.accent))
    setErr('')
    setEditing(true)
  }
  const save = () => {
    try {
      const r = reading.trim()
      setOverride(word.id, { reading: r && r !== word.reading ? r : undefined, accent: accent.trim() === '' ? undefined : Number(accent) }, r || word.reading)
      setEditing(false)
      tick((n) => n + 1)
      onSpeak()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  const reset = () => {
    setOverride(word.id, {})
    setEditing(false)
    tick((n) => n + 1)
  }

  return (
    <div className="pron">
      <div className="row center">
        <button className="speak" onClick={onSpeak}>▶ 发音 <kbd>R</kbd></button>
        <button className="link" onClick={open}>校正读音</button>
      </div>
      {(p.readingOverridden || p.accentStatus === 'user') && (
        <div className="small muted">
          {p.readingOverridden && <>读音已手动校正为「{p.kana}」</>}
          {p.readingOverridden && p.accentStatus === 'user' && ' · '}
          {p.accentStatus === 'user' && `重音：${p.accent === 0 ? '平板' : `第 ${p.accent} 拍后下降`}（手动指定）`}
        </div>
      )}
      {editing && (
        <form className="pron-edit" onSubmit={(e) => { e.preventDefault(); save() }}>
          <label>读音（假名）<input value={reading} onChange={(e) => setReading(e.target.value)} lang="ja" /></label>
          <label>重音（0=平板，1–{moraCount(reading) || '?'}=下降位置，留空=待校验）<input value={accent} onChange={(e) => setAccent(e.target.value)} inputMode="numeric" /></label>
          <p className="small muted">重音只在 VOICEVOX 引擎生效；系统 TTS 只使用假名读音。</p>
          {err && <p className="error small" role="alert">{err}</p>}
          <div className="row">
            <button type="submit" className="primary">保存并试听</button>
            <button type="button" onClick={reset}>恢复词表读音</button>
            <button type="button" onClick={() => setEditing(false)}>取消</button>
          </div>
        </form>
      )}
    </div>
  )
}
