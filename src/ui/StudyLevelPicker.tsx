import { BUILTIN_IDS } from '../db/builtin'
import type { StudyFrame } from '../types'
import { SCOPE_LABEL } from './format'

const levels = ['n5', 'n4', 'n3', 'n2', 'n1'] as const

export function StudyLevelPicker({ lists, selected, grammar = false, onChange }: {
  lists: StudyFrame[]
  selected: StudyFrame
  grammar?: boolean
  onChange: (id: string) => void
}) {
  const unit = grammar ? '题' : '词'
  const choices = levels.map((key) => {
    const level = key.toUpperCase()
    const list = lists.find((item) => grammar ? item.scope === `${level}-only` : item.id === BUILTIN_IDS[key])
    return { level, list }
  })
  const other = lists.filter((list) => !choices.some((choice) => choice.list?.id === list.id))

  return <>
    {choices.some((choice) => choice.list) && <fieldset className="choice-field">
      <legend>{grammar ? '语法级别' : '词汇级别'}</legend>
      <div className="level-choices">
        {choices.map(({ level, list }) => list && <label className="choice-pill" key={level}>
          <input type="radio" name="study-level" checked={list.id === selected.id} onChange={() => onChange(list.id)} />
          <span>{level}</span>
        </label>)}
      </div>
    </fieldset>}
    {other.length > 0 && <label>其他词表
      <select value={other.some((list) => list.id === selected.id) ? selected.id : ''} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>选择累计或自定义词表</option>
        {other.map((list) => <option key={list.id} value={list.id}>{list.name} · {SCOPE_LABEL[list.scope]} · {list.wordIds.length} {unit}</option>)}
      </select>
    </label>}
    <p className="selected-list muted small">{selected.name} · {selected.wordIds.length} {unit}</p>
  </>
}
