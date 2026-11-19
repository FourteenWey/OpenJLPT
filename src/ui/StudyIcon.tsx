const paths = {
  book: 'M12 6.5C9.6 4.6 6.7 4.1 3 5v13c3.7-.9 6.6-.4 9 1.5m0-13c2.4-1.9 5.3-2.4 9-1.5v13c-3.7-.9-6.6-.4-9 1.5m0-13v13',
  bookmark: 'M6 4h12v16l-6-4-6 4V4Z',
  review: 'M4 11a8 8 0 1 1 2.3 6.7M4 5v6h6m2-3v5l3 2',
  records: 'M5 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5V3Zm0 14h14M8 12l3-3 2 2 3-4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  back: 'M20 12H5m6-6-6 6 6 6',
  close: 'm6 6 12 12M6 18 18 6',
  fullscreen: 'M9 4H4v5m11-5h5v5m0 6v5h-5M4 15v5h5',
  exitFullscreen: 'M4 9h5V4m6 0v5h5m0 6h-5v5m-6 0v-5H4',
  audio: 'M11 5 6 9H3v6h3l5 4V5Zm4 4a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12',
  headphones: 'M3 14v-2a9 9 0 0 1 18 0v2M3 14a2 2 0 0 1 2-2h2v8H5a2 2 0 0 1-2-2v-4Zm18 0a2 2 0 0 0-2-2h-2v8h2a2 2 0 0 0 2-2v-4Z',
} as const

export function StudyIcon({ name }: { name: keyof typeof paths }) {
  return <svg className="study-icon" viewBox="0 0 24 24" width="24" height="24" fill="none"
    stroke="currentColor" strokeWidth={name === 'more' ? 3 : 1.65} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={paths[name]} />
  </svg>
}
