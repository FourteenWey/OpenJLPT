// 极简 CSV 读写（RFC 4180：引号转义、字段内换行、CRLF、UTF-8 BOM）。

export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export type Cell = string | number | boolean | null | undefined

interface ToCsvOptions {
  /** 以 = + - @ 开头的文本加前缀，避免 Excel 把它当公式执行。 */
  guardFormulas?: boolean
}

function cell(value: Cell, guard: boolean): string {
  if (value === null || value === undefined) return ''
  let s = String(value)
  if (guard && typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Cell[][], opts: ToCsvOptions = {}): string {
  return rows.map((r) => r.map((c) => cell(c, !!opts.guardFormulas)).join(',')).join('\r\n') + '\r\n'
}
