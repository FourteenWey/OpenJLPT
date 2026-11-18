import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { BUILTIN_IDS, ensureBuiltin } from '../src/db/builtin'
import { openDb, getSetting, req, run } from '../src/db/db'
import { getBaselineMap, getSessionAttempts } from '../src/db/queries'
import { listReviewItems } from '../src/db/review'
import { getGrammarFeedback } from '../src/db/grammarReview'
import { createSession, getSession, listSessions } from '../src/db/sessions'
import { getAllWords, getWordlist, getWords } from '../src/db/wordlists'
import { CHOICE_KEYS, getGrammarQuestion, QUIZ_BLANK } from '../src/lib/grammarQuiz'
import { prefetchKana, setSpeed, setVoicevoxSpeaker, speakText, speakWord, stopSpeaking } from '../src/lib/tts'
import { fsFetcher } from './helpers'

vi.mock('../src/lib/tts', async (importOriginal) => {
  const speakWord = vi.fn(async (_w?: unknown) => {})
  return {
    ...(await importOriginal<typeof import('../src/lib/tts')>()),
    speakWord,
    speakWordThenExample: vi.fn((w: unknown) => speakWord(w)),
    prefetchKana: vi.fn(async () => {}),
    speakText: vi.fn(async () => {}),
    stopSpeaking: vi.fn(),
  }
})

const press = (code: string) => act(() => void fireEvent.keyDown(window, { code, key: code }))

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
  vi.mocked(speakWord).mockClear()
  vi.mocked(speakText).mockClear()
  vi.mocked(prefetchKana).mockClear()
  vi.mocked(stopSpeaking).mockClear()
  vi.stubGlobal('fetch', async (url: string) => ({ ok: true, status: 200, json: async () => fsFetcher(url) }))
})

const cardWord = () => document.querySelector('.card-word')?.textContent
const showsWord = (w: string) => waitFor(() => expect(cardWord()).toBe(w))

async function startSession(size = '5', seed = '11', hint = true) {
  const view = render(<App />)
  await screen.findByRole('heading', { name: '单词快筛' }, { timeout: 3000 })
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
  it('旧数据库自动补齐五个分级样本框，默认 N3，可切换并开始 N1 抽样', async () => {
    const db = await openDb()
    const n3 = await ensureBuiltin(db, 'n3', fsFetcher)
    await run(db, ['wordlists'], 'readwrite', (tx) =>
      req(tx.objectStore('wordlists').put({ ...n3.list, name: 'OpenJLPT N3（仅 N3，不含 N4/N5）' })),
    )
    const cumulative = await ensureBuiltin(db, 'cumulative', fsFetcher)
    render(<App />)
    const picker = await screen.findByLabelText<HTMLSelectElement>('样本框（词表）', undefined, { timeout: 3000 })
    expect(picker.value).toBe(BUILTIN_IDS.n3)

    const sampleSize = screen.getByLabelText<HTMLInputElement>('样本量')
    for (const [kind, count] of [['n5', 674], ['n4', 630], ['n3', 1659], ['n2', 1778], ['n1', 3070]] as const) {
      fireEvent.change(picker, { target: { value: BUILTIN_IDS[kind] } })
      expect(picker.value).toBe(BUILTIN_IDS[kind])
      expect(picker.selectedOptions[0].textContent).toBe(`OpenJLPT ${kind.toUpperCase()} · ${count} 词`)
      expect(sampleSize.max).toBe(String(count))
    }
    expect(await getWordlist(db, BUILTIN_IDS.n3)).toEqual(n3.list)
    expect(await getWordlist(db, BUILTIN_IDS.cumulative)).toEqual(cumulative.list)

    fireEvent.change(sampleSize, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '开始' }))
    await screen.findByText(/先回忆读音与词义/)
    const [session] = await listSessions(db)
    expect(session).toMatchObject({ wordlistId: BUILTIN_IDS.n1, scope: 'N1-only', frameSize: 3070 })
    expect((await getWords(db, session.order)).map((word) => word.level)).toEqual(Array(5).fill('N1'))
    db.close()
  })

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
    await waitFor(() => expect(document.querySelector('.card-reading')).not.toBeNull())
    await press('KeyA')
    await waitFor(async () => expect((await listReviewItems(db))[0].lastGrade).toBe('A'), { timeout: 3000 })
    expect((await getBaselineMap(db)).get(order[0].id)?.grade).toBe('C')
  })

  it('语法单选判分、撤销、刷新续答、答题明细与重做', async () => {
    const view = render(<App />)
    await screen.findByRole('heading', { name: '单词快筛' })
    expect(screen.getByRole('button', { name: '单词', current: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '语法' }))
    const picker = await screen.findByLabelText<HTMLSelectElement>('语法级别')
    expect(picker.value).toBe('jlpt-grammar-n5')
    fireEvent.change(screen.getByLabelText('样本量'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/随机种子/), { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: '开始语法速筛' }))
    const options = await screen.findByRole('group', { name: '选项' })
    expect(within(options).getAllByRole('button')).toHaveLength(4)

    const db = await openDb()
    const [session] = await listSessions(db, 'grammar')
    expect(session.grammarQuiz).toBe(true)
    const [first, second] = session.order.map((id) => getGrammarQuestion(id, session.seed)!)
    const correctText = first.prompt.replace(QUIZ_BLANK, first.answer)
    await waitFor(() => expect(prefetchKana).toHaveBeenCalledWith(
      { wordId: `${session.order[0]}:grammar-answer`, kana: correctText, speed: 1 }, expect.any(AbortSignal),
    ))
    expect(speakText).not.toHaveBeenCalled()
    await press('KeyR')
    expect(speakText).not.toHaveBeenCalled()
    act(() => setSpeed(0.8))
    await waitFor(() => expect(prefetchKana).toHaveBeenCalledWith(
      { wordId: `${session.order[0]}:grammar-answer`, kana: correctText, speed: 0.8 }, expect.any(AbortSignal),
    ))
    const preparations = vi.mocked(prefetchKana).mock.calls.length
    act(() => setVoicevoxSpeaker(80))
    await waitFor(() => expect(vi.mocked(prefetchKana).mock.calls.length).toBeGreaterThan(preparations))
    const wrongIndex = first.options.findIndex((option) => option !== first.answer)
    expect(screen.getByText(first.prompt.replace('\n', ' '))).toBeTruthy()
    expect(screen.queryByText(first.explanation)).toBeNull()
    await press('Space')
    expect(await getSessionAttempts(db, session.id)).toHaveLength(0)
    await press(`Key${CHOICE_KEYS[wrongIndex]}`)
    await screen.findByText('答错了')
    await waitFor(() => expect(speakText).toHaveBeenCalledWith(`${session.order[0]}:grammar-answer`, correctText))
    const plays = vi.mocked(speakText).mock.calls.length
    await press('KeyR')
    expect(speakText).toHaveBeenCalledTimes(plays + 1)
    expect(screen.getByText(first.explanation)).toBeTruthy()
    expect((await getSessionAttempts(db, session.id))[0]).toMatchObject({ choice: first.options[wrongIndex], grade: 'C' })

    view.unmount()
    const resumed = render(<App />)
    await screen.findByText('答错了')
    await press('KeyZ')
    await waitFor(() => expect(screen.queryByText(first.explanation)).toBeNull())
    fireEvent.click(within(screen.getByRole('group', { name: '选项' })).getAllByRole('button')[wrongIndex])
    await screen.findByText('答错了')
    await press('Space')
    await screen.findByText(second.prompt.replace('\n', ' '))
    const stopCount = vi.mocked(stopSpeaking).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '朗读：开' }))
    expect(vi.mocked(stopSpeaking).mock.calls.length).toBeGreaterThan(stopCount)
    // speakText 内部检查开关；这里同时验证关闭后不会继续预取。
    const preparedWhenOff = vi.mocked(prefetchKana).mock.calls.length
    await press(`Key${CHOICE_KEYS[second.options.indexOf(second.answer)]}`)
    await screen.findByText('答对了')
    expect(vi.mocked(prefetchKana).mock.calls.length).toBe(preparedWhenOff)

    resumed.unmount()
    render(<App />)
    await screen.findByText('答对了')
    await press('Space')
    fireEvent.click(await screen.findByRole('button', { name: '查看答题明细' }))
    await screen.findByRole('heading', { name: '答题明细' })
    expect(screen.getByText(/正确率 50.0%/)).toBeTruthy()
    expect(screen.getByText(first.pattern)).toBeTruthy()
    expect(screen.getByText(second.pattern)).toBeTruthy()
    expect((await getBaselineMap(db, 'grammar')).size).toBe(0)
    expect((await getBaselineMap(db)).size).toBe(0)
    expect(await listReviewItems(db)).toEqual([])
    expect(speakWord).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '统计' }))
    expect(screen.getByRole('tab', { name: '语法', selected: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '单词' }))
    await screen.findByText(/还没有基线测试数据/)
    fireEvent.click(screen.getByRole('button', { name: '语法' }))
    fireEvent.click(await screen.findByRole('button', { name: /会话列表/ }))
    await screen.findByLabelText('语法级别')
    fireEvent.change(screen.getByLabelText('样本量'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/随机种子/), { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: '开始语法速筛' }))
    await screen.findByText(first.prompt.replace('\n', ' '))
    expect(screen.getByText(/已答 0 \/ 2/)).toBeTruthy()
    db.close()
  })

  it('语法朗读失败仍可显示解析并继续完成答题', async () => {
    vi.mocked(speakText).mockRejectedValueOnce(new Error('日语语音不可用'))
    render(<App />)
    await screen.findByRole('heading', { name: '单词快筛' })
    fireEvent.click(screen.getByRole('button', { name: '语法' }))
    fireEvent.change(await screen.findByLabelText('样本量'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: '开始语法速筛' }))
    const options = await screen.findByRole('group', { name: '选项' })
    fireEvent.click(within(options).getAllByRole('button')[0])
    expect((await screen.findByRole('alert')).textContent).toContain('日语语音不可用')
    expect(document.querySelector('.grammar-feedback mark')?.textContent).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /查看结果/ }))
    await screen.findByText('本次测试完成')
  })

  it('语法贯通四个页面，复习解析刷新续答、撤销、暂停及统计隔离', async () => {
    const view = render(<App />)
    await screen.findByRole('heading', { name: '单词快筛' })
    fireEvent.click(screen.getByRole('button', { name: '语法' }))
    fireEvent.change(await screen.findByLabelText('样本量'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/随机种子/), { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: '开始语法速筛' }))
    const group = await screen.findByRole('group', { name: '选项' })
    const db = await openDb()
    const [session] = await listSessions(db, 'grammar')
    const question = getGrammarQuestion(session.order[0], session.seed)!
    const selectOption = (correct: boolean) => {
      const buttons = within(screen.getByRole('group', { name: '选项' })).getAllByRole('button')
      fireEvent.click(buttons.find((b) => (b.querySelector('span')?.textContent === question.answer) === correct)!)
    }
    expect(within(group).getAllByRole('button')).toHaveLength(4)
    selectOption(false)
    await screen.findByText('答错了')
    fireEvent.click(screen.getByRole('button', { name: '错题' }))
    await screen.findByRole('heading', { name: '语法错题' })
    expect(screen.getByRole('tab', { name: '语法', selected: true })).toBeTruthy()
    expect(document.querySelector('.grammar-wrong-heading')?.textContent).toContain(question.pattern)
    fireEvent.click(screen.getByRole('button', { name: '进入今日语法复习' }))
    await screen.findByRole('group', { name: '选项' })
    await screen.findByText('语法错题复习')
    vi.mocked(speakText).mockClear()
    expect(speakText).not.toHaveBeenCalled()
    selectOption(true)
    await screen.findByText('答对了')
    await waitFor(() => expect(speakText).toHaveBeenCalledWith(`${session.order[0]}:grammar-answer`, question.prompt.replace(QUIZ_BLANK, question.answer)))
    const feedback = (await getGrammarFeedback(db))!
    expect((await listReviewItems(db, 'grammar'))[0]).toMatchObject({ stage: 1, reviewCount: 1 })

    view.unmount()
    render(<App />)
    await screen.findByText('语法错题复习')
    await screen.findByText('答对了')
    expect((await getGrammarFeedback(db))?.id).toBe(feedback.id)
    expect((await listReviewItems(db, 'grammar'))[0].reviewCount).toBe(1)
    await press('Space')
    await screen.findByRole('heading', { name: '今天没有到期的语法复习' })
    await press('KeyZ')
    await screen.findByRole('group', { name: '选项' })
    expect((await listReviewItems(db, 'grammar'))[0].reviewCount).toBe(0)
    await press('KeyP')
    await screen.findByRole('heading', { name: '已暂停' })
    await press('KeyA')
    expect((await listReviewItems(db, 'grammar'))[0].reviewCount).toBe(0)
    await press('Space')
    await screen.findByRole('group', { name: '选项' })
    selectOption(false)
    await screen.findByText('答错了')
    fireEvent.click(screen.getByRole('button', { name: '统计' }))
    await screen.findByRole('heading', { name: '语法答题统计' })
    expect(screen.getByText('语法复习表现')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '单词' }))
    await screen.findByText(/还没有基线测试数据/)
    fireEvent.click(screen.getByRole('button', { name: '数据' }))
    await screen.findByRole('heading', { name: '词表' })
    expect(screen.queryByRole('heading', { name: '内置语法题库' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: '语法' }))
    await screen.findByRole('heading', { name: '内置语法题库' })
    fireEvent.change(screen.getByLabelText('搜索语法点'), { target: { value: question.pattern } })
    expect(screen.getByRole('button', { name: '导出当前题库 CSV' }).hasAttribute('disabled')).toBe(false)
    expect(document.querySelectorAll('.grammar-library-table tbody tr').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '导出完整 JSON 备份' })).toBeTruthy()
    expect(await listReviewItems(db)).toEqual([])
    expect((await getBaselineMap(db, 'grammar')).size).toBe(0)
    db.close()
  })

  it('删除未作答的语法会话后，刷新可撤销且其他会话保留', async () => {
    const db = await openDb()
    const input = { wordlistId: 'jlpt-grammar-n5', subject: 'grammar', mode: 'sample', sampleSize: 2 } as const
    const quiz = await createSession(db, { ...input, grammarQuiz: true, seed: 42 })
    const old = await createSession(db, { ...input, seed: 43 })
    const view = render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /会话列表/ }))

    const oldRow = (await screen.findByText(/种子 43/)).closest('li')!
    fireEvent.click(within(oldRow).getByRole('button', { name: '删除会话' }))
    await screen.findByText('已删除种子 43 的会话')
    expect(await getSession(db, old.id)).toBeUndefined()
    expect(await getSession(db, quiz.id)).toEqual(quiz)

    view.unmount()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '语法' }))
    fireEvent.click(await screen.findByRole('button', { name: '撤销删除' }))
    await screen.findByText(/种子 43 · 翻卡自评/)
    expect(await getSession(db, old.id)).toEqual(old)
    db.close()
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
    const picker = await screen.findByLabelText<HTMLSelectElement>('词表')
    await waitFor(() => expect(picker.value).toBe(BUILTIN_IDS.n3))
    fireEvent.click(screen.getByRole('button', { name: '开始听音' }))
    await waitFor(() => expect(speakWord).toHaveBeenCalledTimes(1))
    expect(cardWord()).toBeFalsy()

    await press('Space')
    await press('KeyA')
    const listId = BUILTIN_IDS.n3
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
