// 带种子的随机数与洗牌。同一词表 + 同一种子，永远得到同一个抽样结果。

/** mulberry32：32 位种子的小型伪随机数生成器，返回 [0, 1)。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 随机唯一 ID（优先使用 crypto.randomUUID）。 */
export function uid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const buf = new Uint32Array(4)
  crypto.getRandomValues(buf)
  return [...buf].map((n) => n.toString(16).padStart(8, '0')).join('')
}

export function randomSeed(): number {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0]
}

/** FNV-1a 32 位哈希，输出 8 位十六进制。 */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** 用户输入的种子：纯整数按数值使用，其它文本先哈希。空串返回 null。 */
export function parseSeed(input: string): number | null {
  const s = input.trim()
  if (!s) return null
  if (/^\d{1,10}$/.test(s) && Number(s) <= 0xffffffff) return Number(s)
  return parseInt(fnv1a(s), 16)
}

export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items]
  const rand = mulberry32(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** 样本框指纹：与存储顺序无关。 */
export function frameHash(ids: readonly string[]): string {
  return fnv1a([...ids].sort().join('\n'))
}

/**
 * 从样本框无放回地随机抽取 n 个词，返回的顺序即作答顺序。
 * 先按 ID 排序再洗牌，使结果只取决于「样本框内容 + 种子」。
 */
export function drawSample(frameIds: readonly string[], n: number, seed: number): string[] {
  const size = Math.max(0, Math.min(Math.floor(n), frameIds.length))
  return seededShuffle([...frameIds].sort(), seed).slice(0, size)
}
