// 基线会话：创建（抽样/普查）、列表、暂停/恢复、跳转。
import type { Baseline, Session } from '../types'
import { drawSample, frameHash, randomSeed, uid } from '../lib/rng'
import { getAll, getOne, putSetting, req, run } from './db'
import { getWordlist } from './wordlists'

export interface NewSessionInput {
  wordlistId: string
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
  const list = await getWordlist(db, input.wordlistId)
  if (!list) throw new Error('词表不存在')
  const frame = list.wordIds.length
  const size = input.mode === 'census' ? frame : Math.floor(input.sampleSize ?? 0)
  if (!(size >= 1 && size <= frame)) throw new Error(`样本量需在 1 到 ${frame} 之间`)
  const seed = input.seed ?? randomSeed()
  const order = drawSample(list.wordIds, size, seed)
  const rated = new Set((await getAll<Baseline>(db, 'baselines')).map((b) => b.wordId))
  const cursor = firstUnrated(order, rated, 0)
  const iso = now.toISOString()
  const session: Session = {
    id: uid(),
    mode: input.mode,
    wordlistId: list.id,
    wordlistName: list.name,
    scope: list.scope,
    frameType: list.frameType,
    frameSize: frame,
    frameHash: frameHash(list.wordIds),
    seed,
    hint: input.hint ?? 'none',
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
  await run(db, ['sessions', 'settings'], 'readwrite', async (tx) => {
    await req(tx.objectStore('sessions').put(session))
    await req(tx.objectStore('settings').put({ key: 'activeSessionId', value: session.id }))
  })
  return session
}

export const getSession = (db: IDBDatabase, id: string) => getOne<Session>(db, 'sessions', id)

export async function listSessions(db: IDBDatabase): Promise<Session[]> {
  const all = await getAll<Session>(db, 'sessions')
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export const setActiveSession = (db: IDBDatabase, id: string) => putSetting(db, 'activeSessionId', id)

export function setSessionStatus(db: IDBDatabase, id: string, status: 'active' | 'paused', now: Date = new Date()): Promise<Session> {
  return run(db, ['sessions'], 'readwrite', async (tx) => {
    const store = tx.objectStore('sessions')
    const s = (await req(store.get(id))) as Session | undefined
    if (!s) throw new Error('会话不存在')
    if (s.status === 'completed') return s
    const next = { ...s, status, updatedAt: now.toISOString() }
    await req(store.put(next))
    return next
  })
}

/** 跳转到第 position 个位置（从 1 开始）；若该词已有首评，则落在其后最近的未评词上。 */
export function jumpTo(db: IDBDatabase, id: string, position: number, now: Date = new Date()): Promise<Session> {
  return run(db, ['sessions', 'baselines'], 'readwrite', async (tx) => {
    const store = tx.objectStore('sessions')
    const s = (await req(store.get(id))) as Session | undefined
    if (!s) throw new Error('会话不存在')
    if (!Number.isInteger(position) || position < 1 || position > s.order.length) throw new Error(`位置需在 1 到 ${s.order.length} 之间`)
    const rated = new Set((await req(tx.objectStore('baselines').getAllKeys())) as string[])
    const idx = firstUnrated(s.order, rated, position - 1)
    if (idx < 0) return s
    const next = { ...s, cursor: idx, updatedAt: now.toISOString() }
    await req(store.put(next))
    return next
  })
}
