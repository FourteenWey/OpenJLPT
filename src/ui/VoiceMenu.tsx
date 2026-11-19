import { useEffect, useState, useSyncExternalStore, type ChangeEvent } from 'react'
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

export function VoiceSettings({ tts }: { tts: boolean }) {
  const [engine, setEngine] = useState(getEnginePref)
  const [speed, setSpeedState] = useState(getSpeed)
  const [styleId, setStyleId] = useState(getVoicevoxSpeaker)
  const [list, setList] = useState<VoicevoxCharacter[]>([])
  const status = useSyncExternalStore(subscribeTts, getTtsStatus)

  // 展开且选了 VOICEVOX 时才去连本机引擎取列表
  useEffect(() => {
    if (engine !== 'voicevox') return
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
  }, [engine])

  const character = list.find((c) => c.styles.some((s) => s.id === styleId))
  const pickStyle = (id: number) => {
    setVoicevoxSpeaker(id)
    setStyleId(id)
  }
  const onEngine = (e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.currentTarget.value as EnginePref
    setEnginePref(v)
    setEngine(v)
  }
  const onCharacter = (e: ChangeEvent<HTMLSelectElement>) => {
    const next = list.find((c) => c.name === e.currentTarget.value)
    if (next) pickStyle((next.styles.find((s) => s.name === 'ノーマル') ?? next.styles[0]).id)
  }
  const onStyle = (e: ChangeEvent<HTMLSelectElement>) => {
    pickStyle(Number(e.currentTarget.value))
  }
  const onSpeed = (e: ChangeEvent<HTMLSelectElement>) => {
    const v = Number(e.currentTarget.value)
    setSpeed(v)
    setSpeedState(v)
  }

  const note = !tts || !ttsEnabled() ? '' : status.engine ? (status.note ? `已回退到${status.label}：${status.note}` : `当前引擎：${status.label}`) : status.note ? `朗读不可用：${status.note}` : ''

  return (
    <div className="settings-fields" role="group" aria-label="语音设置">
      <label>引擎
        <select value={engine} onChange={onEngine} title="VOICEVOX 需先启动本机引擎，不可用时自动回退到系统 TTS">
          <option value="webspeech">系统 TTS</option>
          <option value="voicevox">VOICEVOX</option>
        </select>
      </label>
      {engine === 'voicevox' && (character ? (
        <>
          <label>发音人
            <select value={character.name} onChange={onCharacter}>
              {list.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </label>
          <label>风格
            <select value={styleId} onChange={onStyle}>
              {character.styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </>
      ) : (
        <p className="small muted">未连接到本机 VOICEVOX 引擎，无法列出发音人。</p>
      ))}
      <label>语速
        <select value={speed} onChange={onSpeed}>
          {SPEEDS.map((s) => <option key={s} value={s}>{s.toFixed(1)}x</option>)}
        </select>
      </label>
      {note && <p className="small muted" role="status">{note}</p>}
    </div>
  )
}
