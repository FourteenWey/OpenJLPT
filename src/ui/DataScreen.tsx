import { useState } from 'react'
import { BUILTIN_IDS, BUILTIN_NAMES, ensureBuiltin, type BuiltinKind } from '../db/builtin'
import { deleteWordlist, listWordlists } from '../db/wordlists'
import { BackupPanel } from './BackupPanel'
import { ImportForm } from './ImportForm'
import { useApp } from './app-context'
import { useLoad } from './useLoad'
import { FRAME_LABEL, SCOPE_LABEL } from './format'
import { errText } from './useScanSession'
import type { StudySubject } from '../types'
import { GrammarLibrary } from './GrammarLibrary'

export function DataScreen({ subject = 'vocabulary' }: { subject?: StudySubject }) {
  const { db, version, bump } = useApp()
  const { data: lists, error } = useLoad(() => listWordlists(db), [db, version])
  const [msg, setMsg] = useState('')

  const load = async (kind: BuiltinKind) => {
    setMsg('')
    try {
      const r = await ensureBuiltin(db, kind)
      setMsg(r.created ? `已载入 ${r.list.name}（${r.list.wordIds.length} 词）。` : '该词表已载入。')
      bump()
    } catch (e) {
      setMsg(errText(e))
    }
  }
  const remove = async (id: string, name: string) => {
    if (!window.confirm(`删除词表「${name}」？词条、首评与复习记录会保留，只移除这个词表。`)) return
    await deleteWordlist(db, id)
    bump()
  }

  const loaded = new Set(lists?.map((l) => l.id))
  return (
    <div className="panel">
      {subject === 'grammar' ? <GrammarLibrary /> : <><section className="block">
        <h2>词表</h2>
        {error && <p className="error">{error}</p>}
        <ul className="cards">
          {lists?.map((l) => (
            <li key={l.id}>
              <div>
                <strong>{l.name}</strong>{' '}
                {!l.scope.endsWith('-only') && <><span className={`badge scope-${l.scope}`}>{SCOPE_LABEL[l.scope]}</span>{' '}</>}
                <span className="muted small">{l.wordIds.length} 词 · {FRAME_LABEL[l.frameType]}</span>
              </div>
              <div className="muted small">来源：{l.source.label}{l.source.version && `（${l.source.version}）`}{l.source.license && ` · ${l.source.license}`}</div>
              {l.source.attribution && <div className="muted small">{l.source.attribution}</div>}
              <button onClick={() => remove(l.id, l.name)}>删除词表</button>
            </li>
          ))}
        </ul>
        <div className="row">
          {(Object.keys(BUILTIN_IDS) as BuiltinKind[]).filter((k) => !loaded.has(BUILTIN_IDS[k])).map((k) => <button key={k} onClick={() => load(k)}>载入 {BUILTIN_NAMES[k]}</button>)}
        </div>
        {msg && <p className="notice" role="status">{msg}</p>}
        <p className="muted small">
          OpenJLPT N1 到 N5 各有独立词表，各自抽样、各自统计。同一个词跨词表共用首评。
          内置释义为英文（JMdict）。N3 词另附 AI 生成的中文释义（未经人工校对，卡片上有标记，带「待核对」的是生成时没把握的词）；
          导入带 <code>meaning_zh</code> 列的自己的词表后，以你的为准。
        </p>
      </section>
      <ImportForm />
      </>}
      <BackupPanel />
      <section className="block">
        <h3>数据来源与许可</h3>
        <p className="small">
          Contains data from <a href="https://github.com/evanclan/OpenJLPT" target="_blank" rel="noreferrer">OpenJLPT</a>{' '}
          (<a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>),
          which uses JMdict and KANJIDIC2 (EDRDG), Jonathan Waller's JLPT lists (tanos.co.uk), and Tatoeba (example sentences, CC BY 2.0 FR).
          JLPT 级别是社区整理的非官方近似，官方并未公布考试词表。完整署名见项目内 NOTICE.md。
        </p>
        <p className="small">朗读语音：默认为系统本地 TTS；选用 VOICEVOX 时为顶栏所选角色的声音（默认 VOICEVOX:もち子(cv 明日葉よもぎ)，由本机 VOICEVOX Engine 合成）；公开发布生成的音频时，请按所选角色的规约署名。</p>
        <p className="small">内置语法点与级别整理自手机应用「语法题列表」（shiri.jp），题干、选项与中文解析由本项目编写。</p>
      </section>
    </div>
  )
}
