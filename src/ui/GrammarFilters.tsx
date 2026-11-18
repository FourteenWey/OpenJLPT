import { GRAMMAR_LEVELS } from '../lib/grammar'

export function GrammarLevelSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label>级别<select value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">全部级别</option>
    {GRAMMAR_LEVELS.map((level) => <option key={level}>{level}</option>)}
  </select></label>
}
