import { useCallback, useEffect, useRef } from 'react'

type Handler = (e: KeyboardEvent) => void

/** 快捷键名称：按 event.code 匹配（不受输入法与键盘布局影响），可带 Mod+ / Shift+ 前缀。 */
export function useHotkeys(map: Record<string, Handler | undefined>, enabled = true): void {
  const ref = useRef(map)
  ref.current = map
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.defaultPrevented || e.repeat || e.altKey || e.isComposing || document.querySelector('dialog[open]')) return
      if (t?.isContentEditable || t?.closest?.('input, textarea, select')) return
      if (e.code === 'Space' && t?.closest?.('button, summary, a[href]')) return
      const name = `${e.metaKey || e.ctrlKey ? 'Mod+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.code}`
      const handler = ref.current[name]
      if (!handler) return
      e.preventDefault()
      handler(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}

/**
 * 每张卡片的有效用时：暂停与页面隐藏期间不计时。
 * cardKey 变化即视为新卡片，计时归零。
 */
export function useCardTimer(cardKey: string | null, paused: boolean) {
  const st = useRef<{ acc: number; since: number | null; revealMs: number | null }>({ acc: 0, since: null, revealMs: null })
  const pausedRef = useRef(paused)

  const sync = useCallback(() => {
    const s = st.current
    const shouldRun = !pausedRef.current && !document.hidden
    const now = performance.now()
    if (s.since !== null && !shouldRun) {
      s.acc += now - s.since
      s.since = null
    } else if (s.since === null && shouldRun) s.since = now
  }, [])

  useEffect(() => {
    pausedRef.current = paused
    sync()
  }, [paused, sync])

  useEffect(() => {
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [sync])

  useEffect(() => {
    st.current = { acc: 0, since: null, revealMs: null }
    sync()
  }, [cardKey, sync])

  const elapsed = useCallback(() => st.current.acc + (st.current.since !== null ? performance.now() - st.current.since : 0), [])
  const markReveal = useCallback(() => {
    if (st.current.revealMs === null) st.current.revealMs = elapsed()
  }, [elapsed])
  const read = useCallback(() => ({ revealMs: st.current.revealMs ?? 0, durationMs: elapsed() }), [elapsed])
  return { markReveal, read }
}
