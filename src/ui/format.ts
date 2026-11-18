import type { Interval } from '../lib/stats'
import type { Scope } from '../types'

export function fmtMs(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} 秒`
  const totalSec = Math.round(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return h ? `${h} 小时 ${m} 分` : `${m} 分 ${s} 秒`
}

export const fmtPct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`
export const fmtInterval = (i: Interval) => `${fmtPct(i.low)} – ${fmtPct(i.high)}`
export const fmtTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false })
export const fileStamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const SCOPE_LABEL: Record<Scope, string> = {
  'N1-only': '仅 N1',
  'N2-only': '仅 N2',
  'N3-only': '仅 N3',
  'N4-only': '仅 N4',
  'N5-only': '仅 N5',
  'N5-N3-cumulative': 'N5–N3 累计',
  custom: '自定义',
}
export const FRAME_LABEL = { complete: '完整词表', curated: '人工挑选' } as const
