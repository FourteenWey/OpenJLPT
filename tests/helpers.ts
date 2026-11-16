import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openDb } from '../src/db/db'
import type { JsonFetcher } from '../src/db/builtin'

/** 直接从 public/ 读取内置词表，等价于浏览器里 fetch 同源静态文件。 */
export const fsFetcher: JsonFetcher = async (url) =>
  JSON.parse(readFileSync(join(process.cwd(), 'public', url.replace(/^\//, '')), 'utf8'))

let counter = 0
export const uniqueDbName = () => `jvs-test-${++counter}-${Math.random().toString(36).slice(2)}`
export const freshDb = () => openDb(uniqueDbName())
