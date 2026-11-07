import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { DomainError } from './errors.js'

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/')
}

export function resolveInside(root: string, relativePath: string): string {
  const normalizedRoot = path.resolve(root)
  const raw = String(relativePath ?? '').trim()
  if (!raw) {
    throw new DomainError('invalid_path', '路径不能为空。')
  }
  if (path.isAbsolute(raw)) {
    throw new DomainError('path_escape', `不接受绝对路径：${raw}`)
  }
  const candidate = path.resolve(normalizedRoot, raw)
  const relative = path.relative(normalizedRoot, candidate)
  if (relative === '') return candidate
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new DomainError('path_escape', `路径超出项目目录：${raw}`)
  }
  return candidate
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

export async function readText(target: string): Promise<string> {
  return fs.readFile(target, 'utf8')
}

export async function readJson<T>(target: string): Promise<T> {
  const raw = await readText(target)
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new DomainError('invalid_json', `JSON 文件无法解析：${path.basename(target)}`)
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await fs.rename(from, to)
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)))
    }
  }
  throw lastError
}

export async function writeTextAtomic(target: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  await fs.writeFile(temp, content, 'utf8')
  try {
    await renameWithRetry(temp, target)
  } catch (error) {
    await fs.rm(temp, { force: true })
    throw error
  }
}

export async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`
  await writeTextAtomic(target, text)
}
