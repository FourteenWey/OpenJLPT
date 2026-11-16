// TTS 引擎实现。每个 Provider 只负责「把一段假名读出来」，选择、回退与缓存在 tts.ts。
import { toAccentKana } from './kana'

export type EngineId = 'webspeech' | 'voicevox' | 'melotts'

export interface SpeakRequest {
  wordId: string
  /** 实际朗读的假名 */
  kana: string
  /** 重音位置（0=平板）；仅 VOICEVOX 使用，缺省时用引擎自己的默认值 */
  accent?: number
  speed: number
}

export interface TtsProvider {
  id: EngineId
  label: string
  /** 播放完成时 resolve；被 signal 中断时静默 resolve。 */
  speak(req: SpeakRequest, signal: AbortSignal): Promise<void>
  /** 当前使用的声音等细节，用于界面显示 */
  detail(): string
}

const aborted = () => new DOMException('aborted', 'AbortError')
export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

// ---------- Web Speech API（默认）----------

const synth = (): SpeechSynthesis | undefined => (typeof speechSynthesis === 'undefined' ? undefined : speechSynthesis)

async function loadVoices(s: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  const now = s.getVoices()
  if (now.length) return now
  await new Promise<void>((res) => {
    const done = () => {
      s.removeEventListener('voiceschanged', done)
      res()
    }
    s.addEventListener('voiceschanged', done)
    setTimeout(done, 1000)
  })
  return s.getVoices()
}

/** 只选本地日语声音：在线声音会把文本发到第三方服务，与「不上传学习数据」冲突。 */
export function pickJaVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const local = voices.filter((v) => v.localService && /^ja([-_]|$)/i.test(v.lang))
  return local.find((v) => /^ja[-_]JP$/i.test(v.lang)) ?? local[0]
}

let voiceName = ''

export const webSpeechProvider: TtsProvider = {
  id: 'webspeech',
  label: '系统 TTS',
  detail: () => voiceName,
  async speak(req, signal) {
    const s = synth()
    if (!s || typeof SpeechSynthesisUtterance === 'undefined') throw new Error('此浏览器不支持 Web Speech 朗读')
    const voice = pickJaVoice(await loadVoices(s))
    if (!voice) throw new Error('没有找到本地日语声音（ja-JP）。请在系统设置里安装日语语音；为避免上传数据，不使用在线声音。')
    voiceName = voice.name
    if (signal.aborted) return
    const u = new SpeechSynthesisUtterance(req.kana)
    u.voice = voice
    u.lang = voice.lang
    u.rate = req.speed
    await new Promise<void>((resolve, reject) => {
      const stop = () => {
        s.cancel()
        resolve()
      }
      signal.addEventListener('abort', stop, { once: true })
      u.onend = () => resolve()
      u.onerror = (e) => (e.error === 'canceled' || e.error === 'interrupted' ? resolve() : reject(new Error(`系统朗读失败：${e.error}`)))
      s.cancel()
      s.speak(u)
    })
  },
}

// ---------- VOICEVOX Engine（可选，本机 HTTP）----------

export const VOICEVOX_URL = 'http://127.0.0.1:50021'
/** 默认音色：もち子さん（ノーマル）。数值是引擎 /speakers 返回的风格 id。 */
export const VOICEVOX_SPEAKER = 20
const K_SPEAKER = 'jvs-tts-voice'
const TIMEOUT_MS = 15000

/** 当前选择的风格 id；用户没选过时用默认音色。 */
export function getVoicevoxSpeaker(): number {
  try {
    const raw = localStorage.getItem(K_SPEAKER)
    const n = Number(raw)
    return raw !== null && Number.isInteger(n) && n >= 0 ? n : VOICEVOX_SPEAKER
  } catch {
    return VOICEVOX_SPEAKER
  }
}
export function setVoicevoxSpeaker(id: number): void {
  try {
    localStorage.setItem(K_SPEAKER, String(id))
  } catch {
    /* 隐私模式下忽略 */
  }
}

export interface VoicevoxCharacter {
  name: string
  styles: { name: string; id: number }[]
}

/** 向本机引擎取发音人与风格列表（只保留能朗读的风格，去掉唱歌用的）。 */
export async function fetchVoicevoxCharacters(signal?: AbortSignal): Promise<VoicevoxCharacter[]> {
  const res = await fetch(`${VOICEVOX_URL}/speakers`, { signal })
  if (!res.ok) throw new Error(`VOICEVOX 引擎返回 ${res.status}`)
  const list = (await res.json()) as { name: string; styles: { name: string; id: number; type?: string }[] }[]
  return list
    .map((c) => ({ name: c.name, styles: c.styles.filter((s) => !s.type || s.type === 'talk' || s.type === 'streaming_talk').map(({ name, id }) => ({ name, id })) }))
    .filter((c) => c.styles.length > 0)
}

async function post(path: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  const timer = new AbortController()
  const t = setTimeout(() => timer.abort(), TIMEOUT_MS)
  const link = () => timer.abort()
  signal.addEventListener('abort', link, { once: true })
  try {
    const res = await fetch(`${VOICEVOX_URL}${path}`, { method: 'POST', ...init, signal: timer.signal })
    if (!res.ok) throw new Error(`VOICEVOX 引擎返回 ${res.status}`)
    return res
  } catch (e) {
    if (signal.aborted) throw aborted()
    if (isAbort(e)) throw new Error(`VOICEVOX 引擎响应超时（${TIMEOUT_MS / 1000} 秒）`)
    if (e instanceof TypeError) throw new Error(`无法连接 VOICEVOX 引擎（${VOICEVOX_URL}）`)
    throw e
  } finally {
    clearTimeout(t)
    signal.removeEventListener('abort', link)
  }
}

/** 合成 WAV：先 audio_query，再按需套用手动重音与语速，最后 synthesis。 */
export async function voicevoxSynthesize(req: SpeakRequest, signal: AbortSignal): Promise<Blob> {
  const speaker = getVoicevoxSpeaker()
  const q = `speaker=${speaker}&text=${encodeURIComponent(req.kana)}`
  const query = JSON.parse(await (await post(`/audio_query?${q}`, {}, signal)).text())
  if (req.accent !== undefined) {
    const text = encodeURIComponent(toAccentKana(req.kana, req.accent))
    query.accentPhrases = JSON.parse(await (await post(`/accent_phrases?speaker=${speaker}&is_kana=true&text=${text}`, {}, signal)).text())
  }
  query.speedScale = req.speed
  const wav = await post(`/synthesis?speaker=${speaker}`, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query) }, signal)
  return wav.blob()
}

export async function playBlob(blob: Blob, signal: AbortSignal): Promise<void> {
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  try {
    await new Promise<void>((resolve, reject) => {
      signal.addEventListener('abort', () => resolve(), { once: true })
      audio.onended = () => resolve()
      audio.onerror = () => reject(new Error('音频播放失败'))
      if (signal.aborted) return resolve()
      audio.play().catch(reject)
    })
  } finally {
    audio.pause()
    URL.revokeObjectURL(url)
  }
}

// ---------- MeloTTS（预留，第一阶段不实现）----------

export const meloTtsProvider: TtsProvider = {
  id: 'melotts',
  label: 'MeloTTS',
  detail: () => '',
  async speak() {
    throw new Error('MeloTTS 尚未接入')
  },
}
