import { readFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve, extname, basename, join } from 'path'
import { Attachment } from './types'

export const IMAGE_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
])

export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '__pycache__',
  '.next',
  'build',
  'target',
])

export async function loadAttachment(
  filePath: string,
  cwd: string,
): Promise<Attachment | null> {
  const resolved = resolve(cwd, filePath)
  if (!existsSync(resolved)) return null
  const name = basename(resolved)
  const ext = extname(resolved).toLowerCase()
  if (IMAGE_EXTS.has(ext)) {
    const buf = await readFile(resolved)
    const mime =
      ext === '.png'
        ? 'image/png'
        : ext === '.gif'
          ? 'image/gif'
          : ext === '.webp'
            ? 'image/webp'
            : 'image/jpeg'
    return {
      path: resolved,
      name,
      type: 'image',
      data: buf.toString('base64'),
      mimeType: mime,
    }
  }
  const data = await readFile(resolved, 'utf-8').catch(() => null)
  if (data === null) return null
  return { path: resolved, name, type: 'file', data }
}

export async function listCwdFiles(cwd: string, maxDepth = 2): Promise<string[]> {
  const results: string[] = []
  async function walk(dir: string, rel: string, depth: number) {
    if (depth > maxDepth || results.length > 300) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue
      const relPath = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        results.push(relPath + '/')
        await walk(join(dir, e.name), relPath, depth + 1)
      } else {
        results.push(relPath)
      }
    }
  }
  await walk(cwd, '', 0)
  return results
}
