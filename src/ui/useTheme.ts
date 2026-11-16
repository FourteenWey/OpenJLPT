import { useCallback, useEffect, useState } from 'react'

type Theme = 'auto' | 'light' | 'dark'
const KEY = 'jvs-theme'
const NEXT: Record<Theme, Theme> = { auto: 'light', light: 'dark', dark: 'auto' }
const LABEL: Record<Theme, string> = { auto: '跟随系统', light: '浅色', dark: '深色' }

function stored(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

/** 深色模式：默认跟随系统，也可手动切换；选择保存在 localStorage。 */
export function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState<Theme>(stored)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* 隐私模式下忽略 */
    }
  }, [theme])
  const cycle = useCallback(() => setTheme((t) => NEXT[t]), [])
  return [LABEL[theme], cycle]
}
