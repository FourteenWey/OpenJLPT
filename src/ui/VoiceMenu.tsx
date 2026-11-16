import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react'
import {
  SPEEDS,
  fetchVoicevoxCharacters,
  getEnginePref,
  getSpeed,
  getTtsStatus,
  getVoicevoxSpeaker,
  setEnginePref,
  setSpeed,
  setVoicevoxSpeaker,
  subscribeTts,
  ttsEnabled,
  type EnginePref,
  type VoicevoxCharacter,
} from '../lib/tts'

/** 顶栏的「语音」入口：一个按钮展开引擎、发音人、风格、语速。发音人与风格取自本机 VOICEVOX 引擎。 */
export function VoiceMenu({ tts }: { tts: boolean }) {
  const [open, setOpen] = useState(false)
  const [engine, setEngine] = useState(getEnginePref)
  const [speed, setSpeedState] = useState(getSpeed)
  const [styleId, setStyleId] = useState(getVoicevoxSpeaker)
  const [list, setList] = useState<VoicevoxCharacter[]>([])
  const status = useSyncExternalStore(subscribeTts, getTtsStatus)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  // 展开且选了 VOICEVOX 时才去连本机引擎取列表
  useEffect(() => {
    if (!open || engine !== 'voicevox') return
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 3000)
    fetchVoicevoxCharacters(ctl.signal)
      .then(setList)
      .catch(() => setList([]))
      .finally(() => clearTimeout(t))
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [open, engine])

  const character = list.find((c) => c.styles.some((s) => s.id === styleId))
  const pickStyle = (id: number) => {
    setVoicevoxSpeaker(id)
    setStyleId(id)
  }
  const onEngine = (e: ChangeEvent<HTMLSelectElement>) => {
    e.currentTarget.blur()
    const v = e.currentTarget.value as EnginePref
    setEnginePref(v)
    setEngine(v)
  }
  const onCharacter = (e: ChangeEvent<HTMLSelectElement>) => {
    e.currentTarget.blur()
    const next = list.find((c) => c.name === e.currentTarget.value)
    if (next) pickStyle((next.styles.find((s) => s.name === 'ノーマル') ?? next.styles[0]).id)
  }
  const onStyle = (e: ChangeEvent<HTMLSelectElement>) => {
    e.currentTarget.blur()
    pickStyle(Number(e.currentTarget.value))
  }
  const onSpeed = (e: ChangeEvent<HTMLSelectElement>) => {
    e.currentTarget.blur()
    const v = Number(e.currentTarget.value)
    setSpeed(v)
    setSpeedState(v)
  }

  const summary = engine === 'voicevox' ? `VOICEVOX${character ? ` · ${character.name}` : ''}` : '系统 TTS'
  const note = !tts || !ttsEnabled() ? '' : status.engine ? (status.note ? `已回退到${status.label}：${status.note}` : `当前引擎：${status.label}`) : status.note ? `朗读不可用：${status.note}` : ''

  return (
    <div className="voice-menu" ref={box}>
      <button className="tab" tabIndex={-1} aria-expanded={open} onClick={(e) => { e.currentTarget.blur(); setOpen((o) => !o) }} title="语音引擎、发音人、风格与语速">
        语音：{summary} ▾
      </button>
      {open && (
        <div className="voice-pop" role="group" aria-label="语音设置">
          <label>引擎
            <select tabIndex={-1} value={engine} onChange={onEngine} title="系统 TTS 无需任何服务；VOICEVOX 需先启动本机引擎，不可用时自动回退到系统 TTS">
              <option value="webspeech">系统 TTS</option>
              <option value="voicevox">VOICEVOX</option>
            </select>
          </label>
          {engine === 'voicevox' && (character ? (
            <>
              <label>发音人
                <select tabIndex={-1} value={character.name} onChange={onCharacter}>
                  {list.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </label>
              <label>风格
                <select tabIndex={-1} value={styleId} onChange={onStyle}>
                  {character.styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            </>
          ) : (
            <p className="small muted">未连接到本机 VOICEVOX 引擎，无法列出发音人。</p>
          ))}
          <label>语速
            <select tabIndex={-1} value={speed} onChange={onSpeed}>
              {SPEEDS.map((s) => <option key={s} value={s}>{s.toFixed(1)}x</option>)}
            </select>
          </label>
          {note && <p className="small muted" role="status">{note}</p>}
        </div>
      )}
    </div>
  )
}
