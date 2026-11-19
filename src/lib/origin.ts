// IndexedDB 按来源隔离，127.0.0.1 与 localhost 的数据互不相通。统一使用 localhost。

/** 返回应跳转到的 localhost 地址（保留端口、路径、查询和哈希）；已在 localhost 或其它主机时返回 null。 */
export function canonicalUrl(href: string): string | null {
  const url = new URL(href)
  if (url.hostname !== '127.0.0.1') return null
  url.hostname = 'localhost'
  return url.href
}
