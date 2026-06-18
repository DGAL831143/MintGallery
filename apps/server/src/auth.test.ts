import { describe, expect, it } from 'vitest'
import { createSessionToken, hashPassword, hashSessionToken, verifyPassword } from './auth.js'

describe('authentication helpers', () => {
  it('hashes and verifies passwords without storing plaintext', async () => {
    const encoded = await hashPassword('a-useful-test-password')
    expect(encoded).not.toContain('a-useful-test-password')
    await expect(verifyPassword('a-useful-test-password', encoded)).resolves.toBe(true)
    await expect(verifyPassword('wrong-password', encoded)).resolves.toBe(false)
  })

  it('creates opaque session tokens and stable hashes', () => {
    const token = createSessionToken()
    expect(token.length).toBeGreaterThan(32)
    expect(hashSessionToken(token)).toHaveLength(64)
    expect(hashSessionToken(token)).toBe(hashSessionToken(token))
  })
})
