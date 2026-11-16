import { createContext, useContext } from 'react'

export interface AppCtx {
  db: IDBDatabase
  /** 数据发生变化（导入、评级、恢复）后递增，页面据此重新读取 */
  version: number
  bump: () => void
}

export const AppContext = createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('AppContext 未提供')
  return ctx
}
