import { useEffect, useState } from 'react'

type Theme = 'auto' | 'light' | 'dark'
const KEY = 'jvs-theme'
export const THEMES = { auto: '跟随系统', light: '浅色', dark: '深色' } as const

function stored(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

/** 深色模式：默认跟随系统，也可手动切换；选择保存在 localStorage。 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(stored)
  useEffect(() => {
    const system = window.matchMedia?.('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'auto' ? (system?.matches ? 'dark' : 'light') : theme
    }
    apply()
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* 隐私模式下忽略 */
    }
    if (theme === 'auto') {
      system?.addEventListener('change', apply)
      return () => system?.removeEventListener('change', apply)
    }
  }, [theme])
  return [theme, setTheme] as const
}
