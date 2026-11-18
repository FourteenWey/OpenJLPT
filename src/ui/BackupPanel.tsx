import { useRef, useState } from 'react'
import { exportBackup, restoreBackup, validateBackup } from '../db/backup'
import { prepareBuiltinWordlists } from '../db/builtin'
import { useApp } from './app-context'
import { downloadText, fileStamp } from './format'
import { errText } from './useScanSession'
import type { Attempt } from '../types'

function backupSummary(file: Awaited<ReturnType<typeof exportBackup>>) {
  const attempts = file.data.attempts as Attempt[]
  return `${file.data.words.length} 词、${attempts.filter((a) => a.subject !== 'grammar').length} 条单词作答，` +
    `${attempts.filter((a) => a.subject === 'grammar').length} 条语法作答、${file.data.grammarBaselines.length} 条语法自评、${file.data.grammarReviewItems.length} 个语法复习项`
}

export function BackupPanel() {
  const { db, bump } = useApp()
  const fileInput = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const backup = async () => {
    const file = await exportBackup(db)
    downloadText(`jlpt-vocab-scanner-backup-${fileStamp()}.json`, JSON.stringify(file), 'application/json')
    setErr('')
    setMsg(`已导出完整备份：${backupSummary(file)}。`)
  }

  const restore = async () => {
    const file = fileInput.current?.files?.[0]
    setMsg('')
    setErr('')
    if (!file) return setErr('请先选择备份 JSON 文件')
    try {
      const parsed: unknown = JSON.parse(await file.text())
      const { file: contents } = validateBackup(parsed)
      const ok = window.confirm(
        `恢复会用备份整体替换当前所有数据（当前数据无法找回，建议先导出备份）。\n备份内容：${backupSummary(contents)}。${contents.version < 3 ? '\n旧备份中的历史语法错题会从恢复当天加入复习。' : ''}\n确定恢复吗？`,
      )
      if (!ok) return
      await restoreBackup(db, parsed)
      await prepareBuiltinWordlists(db)
      bump()
      setMsg('恢复完成。')
    } catch (e) {
      setErr(errText(e))
    }
  }

  return (
    <section className="block">
      <h3>备份与恢复</h3>
      <p className="muted small">完整备份包含单词和语法的会话、作答、自评、复习队列及未离开的解析页。数据只保存在此浏览器中，清除站点数据或换浏览器会丢失。</p>
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
