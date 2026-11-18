// 基线会话：创建（抽样/普查）、列表、暂停/恢复、跳转。
import type { Session, StudySubject } from '../types'
import { grammarFrames } from '../lib/grammar'
import { grammarQuizFrames, quizAnswers } from '../lib/grammarQuiz'
import { drawSample, frameHash, randomSeed, uid } from '../lib/rng'
import { getAll, getOne, getSetting, putSetting, req, run } from './db'
import { baselineStore, readSessionAttempts } from './queries'
import { getWordlist } from './wordlists'

export interface NewSessionInput {
  wordlistId: string
  subject?: StudySubject
  grammarQuiz?: boolean
  mode: 'sample' | 'census'
  sampleSize?: number
  seed?: number
  /** 测试条件：example=词形下方显示例句作为读音提示 */
  hint?: 'example' | 'none'
}

/** 从 from 起（含）向后找第一个还没有首评的位置，到末尾后回绕；全部已评返回 -1。 */
export function firstUnrated(order: readonly string[], rated: ReadonlySet<string>, from: number): number {
  const n = order.length
  for (let k = 0; k < n; k++) {
    const i = (from + k) % n
    if (!rated.has(order[i])) return i
  }
  return -1
}

export async function createSession(db: IDBDatabase, input: NewSessionInput, now: Date = new Date()): Promise<Session> {
  const grammar = input.subject === 'grammar'
  const quiz = grammar && input.grammarQuiz
  const list = grammar
    ? (quiz ? grammarQuizFrames : grammarFrames).find((f) => f.id === input.wordlistId)
    : await getWordlist(db, input.wordlistId)
  if (!list) throw new Error(grammar ? '语法库不存在' : '词表不存在')
  const frame = list.wordIds.length
  const size = input.mode === 'census' ? frame : Math.floor(input.sampleSize ?? 0)
  if (!(size >= 1 && size <= frame)) throw new Error(`样本量需在 1 到 ${frame} 之间`)
  const seed = input.seed ?? randomSeed()
  const order = drawSample(list.wordIds, size, seed)
  const iso = now.toISOString()
  const store = baselineStore(input.subject)
  return run(db, ['sessions', 'settings', store], 'readwrite', async (tx) => {
    const rated = new Set(quiz ? [] : (await req(tx.objectStore(store).getAllKeys())) as string[])
    const cursor = firstUnrated(order, rated, 0)
    const session: Session = {
      id: uid(),
      ...(grammar && { subject: 'grammar' }),
      ...(quiz && { grammarQuiz: true }),
      mode: input.mode,
      wordlistId: list.id,
      wordlistName: list.name,
      scope: list.scope,
      frameType: list.frameType,
      frameSize: frame,
      frameHash: frameHash(list.wordIds),
      seed,
      hint: grammar ? 'none' : input.hint ?? 'none',
      sampleSize: order.length,
      order,
      preRated: order.filter((id) => rated.has(id)).length,
      drawnAt: iso,
      createdAt: iso,
      updatedAt: iso,
      cursor: Math.max(cursor, 0),
      status: cursor < 0 ? 'completed' : 'active',
      activeMs: 0,
      completedAt: cursor < 0 ? iso : undefined,
    }
    await req(tx.objectStore('sessions').put(session))
    await req(tx.objectStore('settings').put({ key: 'activeSessionId', value: session.id }))
    return session
  })
}

export const getSession = (db: IDBDatabase, id: string) => getOne<Session>(db, 'sessions', id)

/** 打开会话时跳过在其他会话中已经首评的项目。 */
export function resumeSession(db: IDBDatabase, id: string, now: Date = new Date()): Promise<Session> {
  return run(db, ['sessions', 'baselines', 'grammarBaselines'], 'readwrite', async (tx) => {
    const store = tx.objectStore('sessions')
    const session = (await req(store.get(id))) as Session | undefined
    if (!session) throw new Error('会话不存在')
    if (session.status === 'completed' || session.grammarQuiz) return session
    const baselines = tx.objectStore(baselineStore(session.subject))
    const current = session.order[session.cursor]
    if (!current || !(await req(baselines.getKey(current)))) return session

    const rated = new Set((await req(baselines.getAllKeys())) as string[])
    const cursor = firstUnrated(session.order, rated, session.cursor)
    const updatedAt = now.toISOString()
    const next: Session = {
      ...session,
      cursor: cursor < 0 ? session.cursor : cursor,
      status: cursor < 0 ? 'completed' : session.status,
      completedAt: cursor < 0 ? updatedAt : undefined,
      updatedAt,
    }
    await req(store.put(next))
    return next
  })
}

export async function listSessions(db: IDBDatabase, subject?: StudySubject): Promise<Session[]> {
  const all = await getAll<Session>(db, 'sessions')
  const sessions = subject ? all.filter((s) => (s.subject ?? 'vocabulary') === subject) : all
  return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export const setActiveSession = (db: IDBDatabase, id: string) => putSetting(db, 'activeSessionId', id)

const DELETED_GRAMMAR_SESSION = 'lastDeletedGrammarSession'

export const getDeletedGrammarSession = (db: IDBDatabase) =>
  getSetting<Session>(db, DELETED_GRAMMAR_SESSION)

export function deleteUnansweredGrammarSession(db: IDBDatabase, id: string): Promise<void> {
  return run(db, ['sessions', 'attempts', 'settings'], 'readwrite', async (tx) => {
    const sessions = tx.objectStore('sessions')
    const session = (await req(sessions.get(id))) as Session | undefined
    if (session?.subject !== 'grammar') throw new Error('语法会话不存在')
    if (await req(tx.objectStore('attempts').index('bySession').count(id))) {
      throw new Error('这条会话已有作答记录')
    }
    const settings = tx.objectStore('settings')
    const active = await req(settings.get('activeSessionId'))
    await req(settings.put({ key: DELETED_GRAMMAR_SESSION, value: session }))
    await req(sessions.delete(id))
    if (active?.value === id) await req(settings.delete('activeSessionId'))
  })
}

export function restoreDeletedGrammarSession(db: IDBDatabase, id: string): Promise<void> {
  return run(db, ['sessions', 'settings'], 'readwrite', async (tx) => {
    const settings = tx.objectStore('settings')
    const deleted = await req(settings.get(DELETED_GRAMMAR_SESSION))
    if (deleted?.value.id !== id) throw new Error('这条会话已无法撤销删除')
    await req(tx.objectStore('sessions').add(deleted.value))
    await req(settings.delete(DELETED_GRAMMAR_SESSION))
  })
}

export function dismissQuizFeedback(db: IDBDatabase, id: string, attemptId: string): Promise<Session> {
  return run(db, ['sessions'], 'readwrite', async (tx) => {
    const store = tx.objectStore('sessions')
    const session = (await req(store.get(id))) as Session | undefined
    if (!session) throw new Error('会话不存在')
    if (session.quizFeedback?.attemptId !== attemptId) return session
    const next = { ...session, quizFeedback: undefined }
    await req(store.put(next))
    return next
  })
}

export function setSessionStatus(db: IDBDatabase, id: string, status: 'active' | 'paused', now: Date = new Date()): Promise<Session> {
  return run(db, ['sessions'], 'readwrite', async (tx) => {
    const store = tx.objectStore('sessions')
    const s = (await req(store.get(id))) as Session | undefined
    if (!s) throw new Error('会话不存在')
    if (s.status === 'completed' || s.quizFeedback) return s
    const next = { ...s, status, updatedAt: now.toISOString() }
    await req(store.put(next))
    return next
  })
}

/** 跳转到第 position 个位置（从 1 开始）；若该词已有首评，则落在其后最近的未评词上。 */
export function jumpTo(db: IDBDatabase, id: string, position: number, now: Date = new Date()): Promise<Session> {
  return run(db, ['sessions', 'attempts', 'baselines', 'grammarBaselines'], 'readwrite', async (tx) => {
    const store = tx.objectStore('sessions')
    const s = (await req(store.get(id))) as Session | undefined
    if (!s) throw new Error('会话不存在')
    if (!Number.isInteger(position) || position < 1 || position > s.order.length) throw new Error(`位置需在 1 到 ${s.order.length} 之间`)
    if (s.quizFeedback) return s
    const rated = new Set(s.grammarQuiz
      ? quizAnswers(await readSessionAttempts(tx, id)).map((a) => a.wordId)
      : (await req(tx.objectStore(baselineStore(s.subject)).getAllKeys())) as string[])
    const idx = firstUnrated(s.order, rated, position - 1)
    if (idx < 0) return s
    const next = { ...s, cursor: idx, updatedAt: now.toISOString() }
    await req(store.put(next))
    return next
  })
}
