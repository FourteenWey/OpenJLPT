import { useRef, useState } from 'react'
import type { ImportReport } from '../lib/importer'
import type { FrameType } from '../types'
import { importCustomList } from '../db/wordlists'
import { useApp } from './app-context'
import { errText } from './useScanSession'

export function ImportForm() {
  const { db, bump } = useApp()
  const fileInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [frameType, setFrameType] = useState<FrameType>('curated')
  const [report, setReport] = useState<ImportReport | null>(null)
  const [msg, setMsg] = useState('')

  const submit = async () => {
    const file = fileInput.current?.files?.[0]
    setMsg('')
    setReport(null)
    if (!file) return setMsg('请先选择 CSV 或 JSON 文件')
    try {
      const res = await importCustomList(db, { name: name || file.name.replace(/\.[^.]+$/, ''), frameType, fileName: file.name, text: await file.text() })
      setReport(res.report)
      bump()
    } catch (e) {
      setMsg(errText(e))
    }
  }

  return (
    <section className="block">
      <h3>导入自己的词表（CSV / JSON）</h3>
      <p className="muted small">
        CSV 首行为表头，必填 <code>word</code>；可选 <code>reading, meaning, meaning_zh, pos, level, id</code>（也认 单词/读音/释义/中文释义/词性）。
        汉字词必须有读音；多个释义或词性用分号分隔；UTF-8 编码。JSON 为词条数组。导入时按稳定 ID、词形+读音与已有词条去重，并沿用其首评。
      </p>
      <div className="form">
        <input ref={fileInput} type="file" accept=".csv,.json,text/csv,application/json" />
        <label>词表名称<input value={name} placeholder="默认使用文件名" onChange={(e) => setName(e.target.value)} /></label>
        <label>样本框性质
          <select value={frameType} onChange={(e) => setFrameType(e.target.value as FrameType)}>
            <option value="curated">人工挑选（不做总体估计）</option>
            <option value="complete">完整词表（随机抽样可给置信区间）</option>
          </select>
        </label>
        <button onClick={submit}>导入</button>
      </div>
      {msg && <p className="error" role="alert">{msg}</p>}
      {report && (
        <div className="notice" role="status">
          读取 {report.rows} 行：新增 {report.added} 词，沿用已有词条 {report.linked} 词，文件内重复 {report.duplicatesInFile} 行，无效 {report.invalid.length} 行。
          {report.invalid.slice(0, 5).map((i) => <div key={i.row} className="small">第 {i.row} 行：{i.reason}</div>)}
          {report.invalid.length > 5 && <div className="small">…另有 {report.invalid.length - 5} 行无效</div>}
        </div>
      )}
    </section>
  )
}
