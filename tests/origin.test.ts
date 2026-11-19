import { describe, expect, it } from 'vitest'
import { canonicalUrl } from '../src/lib/origin'

describe('canonicalUrl', () => {
  it('把 127.0.0.1 换成 localhost，并保留端口、路径、查询和哈希', () => {
    expect(canonicalUrl('http://127.0.0.1:5173/')).toBe('http://localhost:5173/')
    expect(canonicalUrl('http://127.0.0.1:5173/a/b?x=1#h')).toBe('http://localhost:5173/a/b?x=1#h')
  })

  it('已经在 localhost 或其它主机时不跳转', () => {
    expect(canonicalUrl('http://localhost:5173/')).toBeNull()
    expect(canonicalUrl('http://192.168.1.5:5173/')).toBeNull()
    expect(canonicalUrl('http://127.0.0.1.example.com/')).toBeNull()
  })
})
