import type { StudySubject } from '../types'

export function StudySubjectSwitch({ subject, onChange }: { subject: StudySubject; onChange: (subject: StudySubject) => void }) {
  return <div className="subject-switch" role="tablist" aria-label="学习内容">
    {([['vocabulary', '单词'], ['grammar', '语法']] as const).map(([value, label]) =>
      <button key={value} role="tab" aria-selected={subject === value} className={subject === value ? 'primary' : undefined}
        onClick={(e) => { e.currentTarget.blur(); onChange(value) }}>{label}</button>)}
  </div>
}
