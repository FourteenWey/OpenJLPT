import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { moraCount, splitMora, toAccentKana } from '../src/lib/kana'
import { getOverride, resolvePronunciation, setOverride } from '../src/lib/pronunciation'
import {
  VOICEVOX_SPEAKER,
  VOICEVOX_URL,
  audioCacheSize,
  cacheKey,
  getTtsStatus,
  getVoicevoxSpeaker,
  resetTtsState,
  setEnginePref,
  setSpeed,
  setTtsEnabled,
  setVoicevoxSpeaker,
  speakWord,
  speakWordThenExample,
  stopSpeaking,
} from '../src/lib/tts'

// 验收词。見かける、食い違う 不在内置 N5–N3 词表里，这里按词表条目的形状直接构造。
const W = {
  mikakeru: { id: 'w1', word: '見かける', reading: 'みかける' },
  niau: { id: 'w2', word: '似合う', reading: 'にあう' },
  maniau: { id: 'w3', word: '間に合う', reading: 'まにあう' },
  ninki: { id: 'w4', word: '人気', reading: 'にんき' },
  hitoke: { id: 'w5', word: '人気', reading: 'ひとけ' },
  torikaeru: { id: 'w6', word: '取り替える', reading: 'とりかえる' },
  kuichigau: { id: 'w7', word: '食い違う', reading: 'くいちがう' },
}

const voice = (name: string, lang: string, localService: boolean) => ({ name, lang, localService }) as SpeechSynthesisVoice
const utterances: { text: string; lang: string; rate: number; voice: SpeechSynthesisVoice }[] = []
const played: string[] = []
let voices: SpeechSynthesisVoice[] = []

class FakeUtterance {
  voice!: SpeechSynthesisVoice
  lang = ''
  rate = 1
  onend: (() => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  constructor(public text: string) {}
}

class FakeAudio {
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public src: string) {
    played.push(src)
  }
  play = async () => void queueMicrotask(() => this.onended?.())
  pause = () => {}
}

const fakeSynth = {
  getVoices: () => voices,
  addEventListener: () => {},
  removeEventListener: () => {},
  cancel: () => {},
  speak: (u: FakeUtterance) => {
    utterances.push({ text: u.text, lang: u.lang, rate: u.rate, voice: u.voice })
    queueMicrotask(() => u.onend?.())
  },
}

const ok = (body: string | Blob) => ({ ok: true, status: 200, text: async () => String(body), blob: async () => new Blob([body]) })
const engineFetch = () =>
  vi.fn(async (url: string) => (url.includes('/audio_query') ? ok('{"speedScale":1,"accentPhrases":[]}') : url.includes('/accent_phrases') ? ok('[{"moras":[]}]') : ok('wav')))
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string)

beforeEach(() => {
  utterances.length = 0
  played.length = 0
  voices = [voice('Alex', 'en-US', true), voice('Google 日本語', 'ja-JP', false), voice('Kyoko', 'ja-JP', true)]
  localStorage.clear()
  resetTtsState()
  vi.stubGlobal('speechSynthesis', fakeSynth)
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  vi.stubGlobal('Audio', FakeAudio)
  URL.createObjectURL = vi.fn(() => 'blob:wav')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => vi.unstubAllGlobals())

describe('假名工具', () => {
  it('按拍切分，拗音与小写假名并入前一拍', () => {
    expect(splitMora('にんき')).toEqual(['に', 'ん', 'き'])
    expect(splitMora('きょう')).toEqual(['きょ', 'う'])
    expect(moraCount('とりかえる')).toBe(5)
  })
  it('重音记号：n 拍后下降，0（平板）放在末拍', () => {
    expect(toAccentKana('にんき', 1)).toBe("ニ'ンキ")
    expect(toAccentKana('にんき', 0)).toBe("ニンキ'")
    expect(toAccentKana('きょう', 2)).toBe("キョウ'")
  })
})

describe('Web Speech（默认引擎）', () => {
  it('六个验收词都朗读词表假名而不是汉字，并优先选本地 ja-JP 声音', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    for (const w of [W.mikakeru, W.niau, W.maniau, W.ninki, W.torikaeru, W.kuichigau]) await speakWord(w)

    expect(utterances.map((u) => u.text)).toEqual(['みかける', 'にあう', 'まにあう', 'にんき', 'とりかえる', 'くいちがう'])
    expect(utterances.every((u) => u.voice.name === 'Kyoko' && u.lang === 'ja-JP')).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getTtsStatus()).toMatchObject({ engine: 'webspeech', label: '系统 TTS' })
  })

  it('同形多音词是独立词条：人気 按各自读音朗读', async () => {
    await speakWord(W.ninki)
    await speakWord(W.hitoke)
    expect(utterances.map((u) => u.text)).toEqual(['にんき', 'ひとけ'])
  })

  it('先读词，停顿 1 秒再读例句；中途打断则不读例句', async () => {
    vi.useFakeTimers()
    try {
      const ex = { ja: '夜中に目が覚めた。' }
      const run = speakWordThenExample(W.niau, ex)
      await vi.advanceTimersByTimeAsync(900)
      expect(utterances.map((u) => u.text)).toEqual(['にあう'])
      await vi.advanceTimersByTimeAsync(200)
      await run
      expect(utterances.map((u) => u.text)).toEqual(['にあう', ex.ja])

      utterances.length = 0
      const cut = speakWordThenExample(W.niau, ex)
      await vi.advanceTimersByTimeAsync(500)
      stopSpeaking()
      await vi.advanceTimersByTimeAsync(5000)
      await cut
      expect(utterances.map((u) => u.text)).toEqual(['にあう'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('重复播放每次都会朗读；语速写进 rate', async () => {
    await speakWord(W.niau)
    setSpeed(0.8)
    await speakWord(W.niau)
    setSpeed(1.2)
    await speakWord(W.niau)
    expect(utterances.map((u) => u.rate)).toEqual([1, 0.8, 1.2])
  })

  it('没有本地日语声音时报错，不用在线声音', async () => {
    voices = [voice('Alex', 'en-US', true), voice('Google 日本語', 'ja-JP', false)]
    await expect(speakWord(W.niau)).rejects.toThrow(/没有找到本地日语声音/)
    expect(utterances).toHaveLength(0)
  })

  it('关闭朗读后什么都不播', async () => {
    setTtsEnabled(false)
    await speakWord(W.niau)
    expect(utterances).toHaveLength(0)
  })
})

describe('VOICEVOX（可选引擎）', () => {
  beforeEach(() => setEnginePref('voicevox'))

  it('audio_query → synthesis；读音用词表假名，语速写进查询', async () => {
    const fetchMock = engineFetch()
    vi.stubGlobal('fetch', fetchMock)
    setSpeed(0.8)
    await speakWord(W.ninki)

    const [q, s] = fetchMock.mock.calls as unknown as [string, RequestInit][]
    expect(q[0]).toBe(`${VOICEVOX_URL}/audio_query?speaker=${VOICEVOX_SPEAKER}&text=${encodeURIComponent('にんき')}`)
    expect(s[0]).toBe(`${VOICEVOX_URL}/synthesis?speaker=${VOICEVOX_SPEAKER}`)
    expect(bodyOf(s as unknown[]).speedScale).toBe(0.8)
    expect(played).toEqual(['blob:wav'])
    expect(getTtsStatus()).toMatchObject({ engine: 'voicevox', note: '' })
  })

  it('手动重音：用 accent_phrases 的结果替换查询里的重音', async () => {
    const fetchMock = engineFetch()
    vi.stubGlobal('fetch', fetchMock)
    setOverride(W.ninki.id, { accent: 1 }, W.ninki.reading)
    await speakWord(W.ninki)

    const urls = fetchMock.mock.calls.map(([u]) => u as string)
    expect(urls.some((u) => u.includes('/accent_phrases') && u.includes('is_kana=true') && u.includes(encodeURIComponent("ニ'ンキ")))).toBe(true)
    expect(bodyOf(fetchMock.mock.calls[2]).accentPhrases).toEqual([{ moras: [] }])
  })

  it('缓存：再次播放不再请求；速度、重音、读音变化会重新合成', async () => {
    const fetchMock = engineFetch()
    vi.stubGlobal('fetch', fetchMock)
    await speakWord(W.niau)
    const first = fetchMock.mock.calls.length
    await speakWord(W.niau)
    expect(fetchMock.mock.calls.length).toBe(first)
    expect(audioCacheSize()).toBe(1)
    expect(played).toHaveLength(2)

    setSpeed(1.2)
    await speakWord(W.niau)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(first)
    const second = fetchMock.mock.calls.length
    setOverride(W.niau.id, { accent: 0 }, W.niau.reading)
    await speakWord(W.niau)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(second)
    expect(audioCacheSize()).toBe(3)
    expect(cacheKey({ wordId: 'w2', kana: 'にあう', speed: 1, accent: 0 })).toBe(`w2|にあう|${VOICEVOX_SPEAKER}|1|0`)
  })

  it('引擎不可用：自动回退系统 TTS 并说明；短时间内不再重复连接', async () => {
    const fetchMock = vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')))
    vi.stubGlobal('fetch', fetchMock)
    await speakWord(W.mikakeru)

    expect(utterances.map((u) => u.text)).toEqual(['みかける'])
    expect(getTtsStatus().engine).toBe('webspeech')
    expect(getTtsStatus().note).toMatch(/无法连接 VOICEVOX.*已回退到系统 TTS/)
    const calls = fetchMock.mock.calls.length
    await speakWord(W.torikaeru)
    expect(fetchMock.mock.calls.length).toBe(calls)
    expect(utterances).toHaveLength(2)
  })

  it('选择发音人风格后，合成请求用新的风格 id，缓存键随之变化', async () => {
    const fetchMock = engineFetch()
    vi.stubGlobal('fetch', fetchMock)
    setEnginePref('voicevox')
    expect(getVoicevoxSpeaker()).toBe(VOICEVOX_SPEAKER)
    const before = cacheKey({ wordId: 'w2', kana: 'にあう', speed: 1 })
    setVoicevoxSpeaker(80)
    expect(cacheKey({ wordId: 'w2', kana: 'にあう', speed: 1 })).not.toBe(before)
    await speakWord(W.niau)
    expect(fetchMock.mock.calls.map((c) => c[0] as string).every((u) => u.includes('speaker=80'))).toBe(true)
  })

  it('引擎返回错误状态，且系统 TTS 也不可用时，报出两边的原因', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 422 })))
    voices = []
    await expect(speakWord(W.niau)).rejects.toThrow(/VOICEVOX 引擎返回 422.*没有找到本地日语声音/)
  })

  it('新的朗读打断上一段：被打断的一次静默结束', async () => {
    let hung = false
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        if (url.includes('/audio_query') && !hung) {
          hung = true
          return new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
        }
        return Promise.resolve(url.includes('/audio_query') ? ok('{}') : ok('wav'))
      }),
    )
    const first = speakWord(W.niau)
    await speakWord(W.maniau)
    await expect(first).resolves.toBeUndefined()
    expect(played).toHaveLength(1)
  })
})

describe('读音校正', () => {
  it('默认取词表读音，重音待校验；手动校正后生效且可清除', () => {
    expect(resolvePronunciation(W.hitoke)).toMatchObject({ kana: 'ひとけ', accentStatus: 'pending', readingOverridden: false })
    setOverride(W.hitoke.id, { reading: 'ヒトケ', accent: 2 })
    expect(resolvePronunciation(W.hitoke)).toMatchObject({ kana: 'ヒトケ', accent: 2, accentStatus: 'user', readingOverridden: true })
    setOverride(W.hitoke.id, {})
    expect(getOverride(W.hitoke.id)).toBeUndefined()
  })

  it('拒绝汉字读音和越界重音', () => {
    expect(() => setOverride('x', { reading: '人気' })).toThrow('平假名或片假名')
    expect(() => setOverride('x', { accent: 9 }, 'にんき')).toThrow('0（平板）到 3')
    expect(getOverride('x')).toBeUndefined()
  })
})
