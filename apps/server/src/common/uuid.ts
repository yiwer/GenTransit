import { randomBytes } from 'node:crypto'

/** UUID v7（有序）：批量写入时需要预先生成 ID，与 Prisma 的 @default(uuid(7)) 一致 */
export function uuidv7(): string {
  const b = randomBytes(16)
  const ts = BigInt(Date.now())
  for (let i = 0; i < 6; i++) b[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn)
  b[6] = (b[6] & 0x0f) | 0x70
  b[8] = (b[8] & 0x3f) | 0x80
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
