import type { StudySubject } from '../types'

export function StudySubjectSwitch({ subject, onChange }: { subject: StudySubject; onChange: (subject: StudySubject) => void }) {
  return <div className="subject-switch" role="tablist" aria-label="学习内容">
    {([['vocabulary', '单词'], ['grammar', '语法']] as const).map(([value, label]) =>
      <button key={value} role="tab" aria-selected={subject === value} className={subject === value ? 'primary' : undefined}
        tabIndex={subject === value ? 0 : -1}
        onClick={() => onChange(value)}
        onKeyDown={(e) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
          const next = e.key === 'Home' ? 'vocabulary' : e.key === 'End' ? 'grammar' : subject === 'vocabulary' ? 'grammar' : 'vocabulary'
          e.preventDefault()
          e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-subject="${next}"]`)?.focus()
          onChange(next)
        }} data-subject={value}>{label}</button>)}
  </div>
}
