import { useEffect, useState } from 'react'

/** 在依赖变化时重新读取数据；忽略已过期的结果。 */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]): { data?: T; error: string } {
  const [state, setState] = useState<{ data?: T; error: string }>({ error: '' })
  useEffect(() => {
    let alive = true
    loader().then(
      (data) => alive && setState({ data, error: '' }),
      (e) => alive && setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) })),
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}
