// 朗读入口：可插拔 Provider（Web Speech 默认，VOICEVOX 可选，MeloTTS 预留），
// 带音频缓存、失败回退与当前引擎状态。不依赖在线服务，不上传任何数据。
import type { Example, Word } from '../types'
import { resolvePronunciation } from './pronunciation'
import {
  getVoicevoxSpeaker,
  isAbort,
  meloTtsProvider,
  playBlob,
  voicevoxSynthesize,
  webSpeechProvider,
  type EngineId,
  type SpeakRequest,
  type TtsProvider,
} from './ttsProviders'

export {
  VOICEVOX_SPEAKER,
  VOICEVOX_URL,
  fetchVoicevoxCharacters,
  getVoicevoxSpeaker,
  setVoicevoxSpeaker,
  type VoicevoxCharacter,
} from './ttsProviders'

export type EnginePref = 'webspeech' | 'voicevox'
export const SPEEDS = [0.8, 1, 1.2] as const

const K_ON = 'jvs-tts'
const K_ENGINE = 'jvs-tts-engine'
const K_SPEED = 'jvs-tts-speed'

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k: string, v: string): void => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* 隐私模式下忽略 */
  }
}

export const ttsEnabled = (): boolean => read(K_ON) !== 'off'
export const setTtsEnabled = (on: boolean): void => write(K_ON, on ? 'on' : 'off')
/** 默认 Web Speech；只有用户主动选了 VOICEVOX 才会连接本地引擎。 */
export const getEnginePref = (): EnginePref => (read(K_ENGINE) === 'voicevox' ? 'voicevox' : 'webspeech')
export const setEnginePref = (e: EnginePref): void => write(K_ENGINE, e)
export function getSpeed(): number {
  const n = Number(read(K_SPEED))
  return (SPEEDS as readonly number[]).includes(n) ? n : 1
}
export const setSpeed = (n: number): void => write(K_SPEED, String(n))

// ---------- 当前引擎状态（供界面订阅）----------

export interface TtsStatus {
  engine: EngineId | null
  label: string
  /** 回退等需要提示的信息 */
  note: string
}
let status: TtsStatus = { engine: null, label: '', note: '' }
const listeners = new Set<() => void>()
const setStatus = (s: TtsStatus) => {
  status = s
  listeners.forEach((l) => l())
}
export const getTtsStatus = (): TtsStatus => status
export const subscribeTts = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

// ---------- VOICEVOX：按需连接 + 音频缓存 ----------

const CACHE_MAX = 80
const cache = new Map<string, Blob>()
/** 键：词汇 ID、读音、音色、速度、重音。任何一项变化都会重新合成。 */
export const cacheKey = (r: SpeakRequest): string => [r.wordId, r.kana, getVoicevoxSpeaker(), r.speed, r.accent ?? ''].join('|')
export const audioCacheSize = (): number => cache.size

const RETRY_AFTER_MS = 15000
let voicevoxDownUntil = 0

/** 清空缓存、失败退避与状态（测试和「重置」用）。 */
export function resetTtsState(): void {
  stopSpeaking()
  cache.clear()
  voicevoxDownUntil = 0
  setStatus({ engine: null, label: '', note: '' })
}

const voicevoxProvider: TtsProvider = {
  id: 'voicevox',
  label: 'VOICEVOX',
  detail: () => `音色 ${getVoicevoxSpeaker()}`,
  async speak(req, signal) {
    const key = cacheKey(req)
    let blob = cache.get(key)
    if (blob) {
      cache.delete(key)
    } else {
      try {
        blob = await voicevoxSynthesize(req, signal)
      } catch (e) {
        if (!isAbort(e)) voicevoxDownUntil = Date.now() + RETRY_AFTER_MS
        throw e
      }
      if (signal.aborted) return
    }
    cache.set(key, blob)
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
    await playBlob(blob, signal)
  },
}

// ---------- 播放与回退 ----------

let current: AbortController | null = null
/** 「读词 → 等待 → 读例句」序列的代号与等待取消函数；任何新的朗读或 stopSpeaking 都会使旧序列作废。 */
let seq = 0
let cancelWait: (() => void) | null = null

export function stopSpeaking(): void {
  current?.abort()
  current = null
  seq++
  cancelWait?.()
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 朗读一段假名。新的朗读会打断上一段；被打断时静默返回。 */
export async function speakKana(req: SpeakRequest): Promise<void> {
  stopSpeaking()
  const ctl = new AbortController()
  current = ctl
  const { signal } = ctl
  const wantVoicevox = getEnginePref() === 'voicevox'
  const skipVoicevox = wantVoicevox && Date.now() < voicevoxDownUntil && !cache.has(cacheKey(req))
  const chain: TtsProvider[] = wantVoicevox && !skipVoicevox ? [voicevoxProvider, webSpeechProvider] : [webSpeechProvider]
  let note = skipVoicevox ? 'VOICEVOX 暂不可用，已使用系统 TTS' : ''
  const errors: string[] = []
  for (const p of chain) {
    try {
      await p.speak(req, signal)
      if (signal.aborted) return
      setStatus({ engine: p.id, label: p.label, note: errors.length ? `${errors[0]}，已回退到${p.label}` : note })
      return
    } catch (e) {
      if (signal.aborted || isAbort(e)) return
      errors.push(errMsg(e))
    }
  }
  note = errors.join('；')
  setStatus({ engine: null, label: '', note })
  throw new Error(note)
}

/** 朗读词条的读音：用词表假名（或手动纠正后的假名），不让引擎自己判断汉字读法。 */
export function speakWord(w: Pick<Word, 'id' | 'word' | 'reading'>): Promise<void> {
  if (!ttsEnabled()) return Promise.resolve()
  const p = resolvePronunciation(w)
  return speakKana({ wordId: w.id, kana: p.kana, accent: p.accent, speed: getSpeed() })
}

export const EXAMPLE_DELAY_MS = 1000

/** 先读词条，读完停顿 1 秒再读例句。中途被打断（翻页、重播、关闭朗读）则不再读例句。 */
export async function speakWordThenExample(w: Pick<Word, 'id' | 'word' | 'reading'>, example?: Pick<Example, 'ja'>): Promise<void> {
  const first = speakWord(w)
  const id = seq
  await first
  if (!example?.ja || !ttsEnabled() || id !== seq) return
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, EXAMPLE_DELAY_MS)
    cancelWait = () => {
      clearTimeout(t)
      resolve()
    }
  })
  cancelWait = null
  if (id !== seq) return
  await speakKana({ wordId: `${w.id}:example`, kana: example.ja, speed: getSpeed() })
}

export { meloTtsProvider }
