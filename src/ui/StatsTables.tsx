import type { DimRow } from '../lib/stats'
import { fmtPct } from './format'

export function DimTable({ title, rows, note }: { title: string; rows: DimRow[]; note?: string }) {
  if (!rows.length) return null
  return (
    <section className="block">
      <h3>{title}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>类别</th><th>词数</th><th>A 掌握</th><th>B 模糊</th><th>C 不认识</th><th>A 占比</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}{r.n < 10 && <span className="muted small"> （词数少）</span>}</td>
                <td>{r.n}</td>
                <td>{r.counts.A}</td>
                <td>{r.counts.B}</td>
                <td>{r.counts.C}</td>
                <td>
                  <span className="bar"><i style={{ width: `${r.rateA * 100}%` }} /></span> {fmtPct(r.rateA)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <p className="muted small">{note}</p>}
    </section>
  )
}
