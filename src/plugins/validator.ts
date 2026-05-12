import type { PluginManifest } from '../types/plugin.js'

const KEBAB_RE  = /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?$/
const KNOWN_FIELDS = new Set<string>(['name', 'version', 'description', 'author', 'tools', 'commands'])

export function validateManifest(json: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { valid: false, errors: ['Manifest must be a JSON object'] }
  }

  const m = json as Record<string, unknown>

  if (typeof m.name !== 'string' || !m.name) {
    errors.push('"name" is required and must be a non-empty string')
  } else if (!KEBAB_RE.test(m.name)) {
    errors.push('"name" must be kebab-case (lowercase letters, numbers, hyphens)')
  }

  if (typeof m.version !== 'string' || !m.version) {
    errors.push('"version" is required and must be a non-empty string')
  } else if (!SEMVER_RE.test(m.version)) {
    errors.push('"version" must be valid semver (e.g. 1.0.0)')
  }

  if (typeof m.description !== 'string' || !m.description.trim()) {
    errors.push('"description" is required and must be a non-empty string')
  }

  if (typeof m.author !== 'string' || !m.author.trim()) {
    errors.push('"author" is required and must be a non-empty string')
  }

  if (!Array.isArray(m.tools) || m.tools.length === 0) {
    errors.push('"tools" must be a non-empty array of strings')
  } else if ((m.tools as unknown[]).some(t => typeof t !== 'string')) {
    errors.push('"tools" must contain only strings')
  }

  if (m.commands !== undefined) {
    if (!Array.isArray(m.commands) || m.commands.length === 0) {
      errors.push('"commands" must be a non-empty array of strings if provided')
    } else if ((m.commands as unknown[]).some(c => typeof c !== 'string')) {
      errors.push('"commands" must contain only strings')
    }
  }

  for (const key of Object.keys(m)) {
    if (!KNOWN_FIELDS.has(key)) errors.push(`Unknown field "${key}" is not allowed`)
  }

  return { valid: errors.length === 0, errors }
}

export type { PluginManifest }
