import { useEffect, useRef, useState } from 'react'
import { useHotkeys } from './hooks'

type StudyMode = 'fullscreen' | 'immersive' | null

export function useStudyFullscreen() {
  const root = document.documentElement
  const supportsFullscreen = document.fullscreenEnabled && typeof root.requestFullscreen === 'function'
  const [mode, setMode] = useState<StudyMode>(() => document.fullscreenElement === root ? 'fullscreen' : null)
  const pending = useRef(false)

  useEffect(() => {
    const sync = () => setMode((current) =>
      document.fullscreenElement === root ? 'fullscreen' : current === 'fullscreen' ? null : current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [root])

  useHotkeys({ Escape: () => setMode(null) }, mode === 'immersive')

  const toggle = async () => {
    if (pending.current) return
    if (mode === 'immersive') {
      setMode(null)
      return true
    }

    pending.current = true
    const exiting = document.fullscreenElement === root
    try {
      if (exiting) await document.exitFullscreen()
      else if (supportsFullscreen) await root.requestFullscreen({ navigationUI: 'hide' })
      else setMode('immersive')
    } catch {
      if (exiting) return false
      setMode('immersive')
    } finally {
      pending.current = false
    }
    return true
  }

  return { mode, supportsFullscreen, toggle }
}
