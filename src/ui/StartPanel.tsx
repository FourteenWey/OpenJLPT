import { useState } from 'react'
import { createSession } from '../db/sessions'
import { listSessions } from '../db/sessions'
import { listWordlists } from '../db/wordlists'
import { getBaselineMap } from '../db/queries'
import { parseSeed } from '../lib/rng'
import { useApp } from './app-context'
import { useLoad } from './useLoad'
import { FRAME_LABEL, SCOPE_LABEL, fmtTime } from './format'

interface Props {
  onOpen: (sessionId: string) => void
  onStats: (sessionId: string) => void
}

const STATUS = { active: '进行中', paused: '已暂停', completed: '已完成' } as const

export function StartPanel({ onOpen, onStats }: Props) {
  const { db, version, bump } = useApp()
  const { data, error } = useLoad(
    async () => ({ lists: await listWordlists(db), sessions: await listSessions(db), base: await getBaselineMap(db) }),
    [db, version],
  )
  const [listId, setListId] = useState('')
  const [mode, setMode] = useState<'sample' | 'census'>('sample')
  const [size, setSize] = useState('200')
  const [seedText, setSeedText] = useState('')
  const [hint, setHint] = useState(true)
  const [msg, setMsg] = useState('')

  if (!data) return <p className="muted pad">{error || '加载中…'}</p>
  const list = data.lists.find((l) => l.id === listId) ?? data.lists[0]
  if (!list) return <p className="pad">还没有词表。请先到「数据」页载入 OpenJLPT 词表或导入你自己的 CSV/JSON。</p>

  const start = async () => {
    setMsg('')
    try {
      const n = Number(size)
      if (mode === 'sample' && !Number.isInteger(n)) throw new Error('样本量需要是整数')
      const s = await createSession(db, { wordlistId: list.id, mode, sampleSize: n, seed: parseSeed(seedText) ?? undefined, hint: hint ? 'example' : 'none' })
      bump()
      onOpen(s.id)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="panel">
      <h2>新建首次基线测试</h2>
      <div className="form">
        <label>
          样本框（词表）
          <select value={list.id} onChange={(e) => setListId(e.target.value)}>
            {data.lists.map((l) => (
              <option key={l.id} value={l.id}>{l.name} · {SCOPE_LABEL[l.scope]} · {l.wordIds.length} 词</option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>方式</legend>
          <label className="inline"><input type="radio" checked={mode === 'sample'} onChange={() => setMode('sample')} /> 随机抽样</label>
          <label className="inline"><input type="radio" checked={mode === 'census'} onChange={() => setMode('census')} /> 全量普查（{list.wordIds.length} 词）</label>
        </fieldset>
        {mode === 'sample' && (
          <div className="row">
            <label>样本量<input type="number" min={1} max={list.wordIds.length} value={size} onChange={(e) => setSize(e.target.value)} /></label>
            <label>随机种子（可选）<input value={seedText} placeholder="留空则自动生成并记录" onChange={(e) => setSeedText(e.target.value)} /></label>
          </div>
        )}
        <label className="inline">
          <input type="checkbox" checked={hint} onChange={(e) => setHint(e.target.checked)} />
          词形下方显示例句，帮助判断读音
        </label>
        <p className="muted small">
          例句来自 Tatoeba，按词形匹配，个别多音词的句子读音可能与词条不同，以答案面的读音为准。有例句提示时更容易想起词义，掌握率会比只看词形偏高，
          条件会记录在会话里；想和之前的结果比较，请保持同样的设置。没有例句的词只显示词形。
        </p>
        <p className="muted small">
          {list.scope === 'N3-only' && '范围：只含 N3 级别词，不含 N4/N5。'}
          {list.scope === 'N5-N3-cumulative' && '范围：N5、N4、N3 累计词汇；统计页会按级别分开列出。'}
          {list.scope === 'custom' && '范围：自定义词表。'}
          {list.frameType === 'curated' ? ' 该词表为人工挑选，结果不推断总体。' : mode === 'sample' ? ' 无放回随机抽取；答完后给出 95% 置信区间。' : ''}
          {' '}已有首评的词会沿用原评级，不再询问。
        </p>
        <button className="primary" onClick={start}>开始</button>
        {msg && <p className="error" role="alert">{msg}</p>}
      </div>

      <h2>历史会话</h2>
      {data.sessions.length === 0 && <p className="muted">还没有会话。</p>}
      <ul className="cards">
        {data.sessions.map((s) => {
          const rated = s.order.filter((id) => data.base.has(id)).length
          return (
            <li key={s.id}>
              <div>
                <strong>{s.wordlistName}</strong> <span className={`badge scope-${s.scope}`}>{SCOPE_LABEL[s.scope]}</span>{' '}
                <span className="muted small">{s.mode === 'sample' ? `抽样 n=${s.sampleSize}` : '全量普查'} · 种子 {s.seed} · {FRAME_LABEL[s.frameType]}</span>
              </div>
              <div className="muted small">{STATUS[s.status]} · 已评 {rated}/{s.sampleSize} · 创建于 {fmtTime(s.createdAt)}</div>
              <div className="row">
                <button onClick={() => onOpen(s.id)}>{s.status === 'completed' ? '查看' : '继续'}</button>
                <button onClick={() => onStats(s.id)}>统计</button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
