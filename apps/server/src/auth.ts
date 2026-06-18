import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

export const SESSION_COOKIE = 'mintgallery_session'
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000

export interface SessionUser {
  id: string
  username: string
  role: 'ADMIN' | 'MEMBER'
  status: 'ACTIVE' | 'DISABLED'
  mustChangePassword: boolean
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer
  return `scrypt$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, encodedSalt, encodedKey] = storedHash.split('$')
  if (algorithm !== 'scrypt' || !encodedSalt || !encodedKey) return false

  const salt = Buffer.from(encodedSalt, 'base64url')
  const expected = Buffer.from(encodedKey, 'base64url')
  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer

  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function publicUser(row: {
  id: string
  username: string
  role: string
  status: string
  must_change_password: number
}): SessionUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role as SessionUser['role'],
    status: row.status as SessionUser['status'],
    mustChangePassword: Boolean(row.must_change_password),
  }
}
