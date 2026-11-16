import { useRef, useState } from 'react'
import { exportBackup, restoreBackup, validateBackup } from '../db/backup'
import { refreshBuiltinWords } from '../db/builtin'
import { applyGeneratedZh } from '../db/zh'
import { useApp } from './app-context'
import { downloadText, fileStamp } from './format'
import { errText } from './useScanSession'

export function BackupPanel() {
  const { db, bump } = useApp()
  const fileInput = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const backup = async () => {
    const file = await exportBackup(db)
    downloadText(`jlpt-vocab-scanner-backup-${fileStamp()}.json`, JSON.stringify(file), 'application/json')
    setErr('')
    setMsg(`已导出备份：${file.data.words.length} 词，${file.data.attempts.length} 条作答记录。`)
  }

  const restore = async () => {
    const file = fileInput.current?.files?.[0]
    setMsg('')
    setErr('')
    if (!file) return setErr('请先选择备份 JSON 文件')
    try {
      const parsed: unknown = JSON.parse(await file.text())
      const { counts } = validateBackup(parsed)
      const ok = window.confirm(
        `恢复会用备份整体替换当前所有数据（当前数据无法找回，建议先导出备份）。\n备份内容：${counts.wordlists} 个词表，${counts.words} 词，${counts.sessions} 个会话，${counts.baselines} 条首评，${counts.attempts} 条作答记录。\n确定恢复吗？`,
      )
      if (!ok) return
      await restoreBackup(db, parsed)
      await refreshBuiltinWords(db).catch(() => 0)
      await applyGeneratedZh(db)
      bump()
      setMsg('恢复完成。')
    } catch (e) {
      setErr(errText(e))
    }
  }

  return (
    <section className="block">
      <h3>备份与恢复</h3>
      <p className="muted small">数据只保存在这台电脑的浏览器 IndexedDB 中。清除站点数据或换浏览器会丢失，请定期导出完整备份。</p>
      <div className="row">
        <button onClick={backup}>导出完整 JSON 备份</button>
        <input ref={fileInput} type="file" accept=".json,application/json" />
        <button onClick={restore}>从备份恢复</button>
      </div>
      {msg && <p className="notice" role="status">{msg}</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  )
}
