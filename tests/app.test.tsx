import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { openDb, getSetting } from '../src/db/db'
import { getBaselineMap } from '../src/db/queries'
import { listReviewItems } from '../src/db/review'
import { listSessions } from '../src/db/sessions'
import { getAllWords, listWordlists } from '../src/db/wordlists'
import { speakWord } from '../src/lib/tts'
import { fsFetcher } from './helpers'

vi.mock('../src/lib/tts', async (importOriginal) => {
  const speakWord = vi.fn(async (_w?: unknown) => {})
  return {
    ...(await importOriginal<typeof import('../src/lib/tts')>()),
    speakWord,
    speakWordThenExample: vi.fn((w: unknown) => speakWord(w)),
  }
})

const press = (code: string) => act(() => void fireEvent.keyDown(window, { code, key: code }))

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
  vi.mocked(speakWord).mockClear()
  vi.stubGlobal('fetch', async (url: string) => ({ ok: true, status: 200, json: async () => fsFetcher(url) }))
})

const cardWord = () => document.querySelector('.card-word')?.textContent
const showsWord = (w: string) => waitFor(() => expect(cardWord()).toBe(w))

async function startSession(size = '5', seed = '11', hint = true) {
  const view = render(<App />)
  await screen.findByText('新建首次基线测试')
  fireEvent.change(screen.getByLabelText('样本量'), { target: { value: size } })
  fireEvent.change(screen.getByLabelText(/随机种子/), { target: { value: seed } })
  const box = screen.getByLabelText(/词形下方显示例句/) as HTMLInputElement
  if (box.checked !== hint) fireEvent.click(box)
  fireEvent.click(screen.getByRole('button', { name: '开始' }))
  await screen.findByText(/先回忆读音与词义/)
  const db = await openDb()
  const [session] = await listSessions(db)
  const words = new Map((await getAllWords(db)).map((w) => [w.id, w]))
  return { view, db, session, order: session.order.map((id) => words.get(id)!) }
}

describe('键盘快筛流程（端到端，含 IndexedDB）', () => {
  it('默认只显示词形；Space 才显示答案；评级后自动下一词', async () => {
    const { db, order } = await startSession('5', '11', false)
    expect(cardWord()).toBe(order[0].word)
    expect(document.querySelector('.card-example')).toBeNull()
    if (order[0].reading !== order[0].word) expect(screen.queryByText(order[0].reading)).toBeNull()
    expect(screen.queryByText(order[0].meanings[0], { exact: false })).toBeNull()

    await press('KeyA')
    expect((await getBaselineMap(db)).size).toBe(0)

    await press('Space')
    expect(document.querySelector('.card-en')).toBeNull()
    const zh = document.querySelector('.card-zh')
    expect(zh?.textContent).toMatch(/[\u3400-\u9fff]/)
    expect(zh?.querySelector('.gen-tag')?.textContent).toContain('AI 生成')
    await press('KeyA')
    await showsWord(order[1].word)
    await waitFor(async () => expect((await getBaselineMap(db)).get(order[0].id)?.grade).toBe('A'))
  })

  it('开启例句提示：翻卡前词形下方显示例句并标出目标词，翻卡后不显示译文与出处', async () => {
    const { session, order } = await startSession('5', '11', true)
    expect(session.hint).toBe('example')
    const w = order[0]
    const box = document.querySelector('.card-example')
    expect(!!box).toBe(!!w.example)
    expect(document.querySelector('.card-reading')).toBeNull()
    if (w.example) {
      expect(box?.textContent).toBe(w.example.ja)
      await press('Space')
      expect(document.querySelector('.card-example-tr')).toBeNull()
      expect(document.querySelector('.card-example a')).toBeNull()
    }
  })

  it('A/S/D 三键、撤销、暂停，刷新后从断点继续，完成后可查看统计', async () => {
    const { view, db, order } = await startSession()
    for (const key of ['KeyA', 'KeyS', 'KeyD']) {
      await press('Space')
      await press(key)
      await waitFor(async () => expect((await getBaselineMap(db)).size).toBe(['KeyA', 'KeyS', 'KeyD'].indexOf(key) + 1))
    }
    const base = await getBaselineMap(db)
    expect(order.slice(0, 3).map((w) => base.get(w.id)?.grade)).toEqual(['A', 'B', 'C'])
    expect((await listReviewItems(db)).map((i) => i.wordId).sort()).toEqual([order[1].id, order[2].id].sort())

    await press('KeyZ')
    await waitFor(async () => expect((await getBaselineMap(db)).has(order[2].id)).toBe(false))
    await showsWord(order[2].word)

    await press('KeyP')
    await screen.findByText('已暂停')
    await press('KeyA')
    expect((await getBaselineMap(db)).size).toBe(2)
    await press('Space')
    await showsWord(order[2].word)

    // 模拟刷新：卸载后重新渲染，应直接回到同一个词
    view.unmount()
    const again = render(<App />)
    await showsWord(order[2].word)
    expect((await getBaselineMap(db)).size).toBe(2)

    for (let i = 2; i < 5; i++) {
      await press('Space')
      await press('KeyA')
      await waitFor(async () => expect((await getBaselineMap(db)).size).toBe(i + 1))
    }
    await screen.findByText('本次测试完成')
    fireEvent.click(screen.getByRole('button', { name: '查看统计' }))
    await screen.findByText(/独立识词覆盖率（A 占比）/)
    expect(again.container.textContent).toContain('完成率')
    expect(again.container.textContent).toContain('100.0%')
  })

  it('首次评级不会被之后的复习覆盖', async () => {
    const { db, order } = await startSession('3', '5')
    await press('Space')
    await press('KeyD')
    await waitFor(async () => expect((await getBaselineMap(db)).size).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: '复习' }))
    await screen.findByText(/复测 · 当天 · 首评 C/)
    await press('Space')
    await press('KeyA')
    await waitFor(async () => expect((await listReviewItems(db))[0].lastGrade).toBe('A'))
    expect((await getBaselineMap(db)).get(order[0].id)?.grade).toBe('C')
  })

  it('Space 显示答案时朗读当前词；评级键、暂停后的 Space 不朗读', async () => {
    const { order } = await startSession('3', '5')
    expect(speakWord).not.toHaveBeenCalled()

    await press('KeyA')
    expect(speakWord).not.toHaveBeenCalled()

    await press('Space')
    expect(speakWord).toHaveBeenCalledTimes(1)
    expect(speakWord).toHaveBeenLastCalledWith(expect.objectContaining({ id: order[0].id }))

    await press('Space')
    expect(speakWord).toHaveBeenCalledTimes(1)

    await press('KeyA')
    await showsWord(order[1].word)
    await press('KeyP')
    await screen.findByText('已暂停')
    await press('Space')
    await showsWord(order[1].word)
    expect(speakWord).toHaveBeenCalledTimes(1)
  })

  it('朗读失败不影响翻卡，并在页面上提示原因', async () => {
    vi.mocked(speakWord).mockRejectedValueOnce(new Error('无法连接 VOICEVOX 引擎'))
    await startSession('3', '5')
    await press('Space')
    expect((await screen.findByRole('alert')).textContent).toContain('无法连接 VOICEVOX 引擎')
    expect(document.querySelector('.card-zh')).toBeTruthy()
  })

  it('R 在翻面后重播发音，不影响评分；翻面前按 R 不发音', async () => {
    const { db, order } = await startSession('3', '5')
    await press('KeyR')
    expect(speakWord).not.toHaveBeenCalled()

    await press('Space')
    await press('KeyR')
    await press('KeyR')
    expect(speakWord).toHaveBeenCalledTimes(3)
    expect((await getBaselineMap(db)).size).toBe(0)

    await press('KeyA')
    await waitFor(async () => expect((await getBaselineMap(db)).get(order[0].id)?.grade).toBe('A'))
  })

  it('听音识词：独立成绩，不写入视觉基线', async () => {
    const { db } = await startSession('3', '5')
    fireEvent.click(screen.getByRole('button', { name: '听音' }))
    fireEvent.click(await screen.findByRole('button', { name: '开始听音' }))
    await waitFor(() => expect(speakWord).toHaveBeenCalledTimes(1))
    expect(cardWord()).toBeFalsy()

    await press('Space')
    await press('KeyA')
    const listId = (await listWordlists(db))[0].id
    await waitFor(async () => expect(((await getSetting<unknown[]>(db, `listen:${listId}`)) ?? []).length).toBe(1))
    expect((await getBaselineMap(db)).size).toBe(0)
  })

  it('顶栏可以关闭朗读，选择保存在 localStorage', async () => {
    await startSession('3', '5')
    fireEvent.click(screen.getByRole('button', { name: '朗读：开' }))
    expect(screen.getByRole('button', { name: '朗读：关' })).toBeTruthy()
    expect(localStorage.getItem('jvs-tts')).toBe('off')
  })
})
