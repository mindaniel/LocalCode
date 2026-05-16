import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const CACHE_FILE = path.join(os.homedir(), '.localcode', 'update-cache.json')
const CHECK_INTERVAL = 1000 * 60 * 60 * 6  // 6 hours

const NPM_PACKAGE  = 'localcode-agent'
const GITHUB_REPO  = 'lsheasel/LocalCode'

interface UpdateCache {
  checkedAt: number
  latestVersion: string | null
  installMethod: 'npm' | 'git'
}

export interface UpdateInfo {
  latestVersion: string
  installMethod: 'npm' | 'git'
  updateCommand: string
}

// ── Install-method detection ─────────────────────────────────────────────────

function detectInstallMethod(): 'npm' | 'git' {
  const script = process.argv[1] ?? ''

  // npm global installs always have "node_modules" somewhere in the path
  if (script.includes('node_modules')) return 'npm'

  // If running from a directory that has a .git folder nearby → git clone
  let dir = path.dirname(script)
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return 'git'
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // Fallback: assume npm
  return 'npm'
}

function updateCommandFor(method: 'npm' | 'git', repoDir?: string): string {
  if (method === 'git') {
    const dir = repoDir ?? '~/LocalCode'
    return `cd ${dir} && git pull && npm install && npm run build`
  }
  return `npm install -g ${NPM_PACKAGE}`
}

// ── Semver helper ────────────────────────────────────────────────────────────

function semverGt(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na > nb) return true
    if (na < nb) return false
  }
  return false
}

// ── Cache helpers ────────────────────────────────────────────────────────────

function readCache(): UpdateCache | null {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as UpdateCache
  } catch { return null }
}

function writeCache(data: UpdateCache): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf-8')
  } catch {}
}

// ── Remote version fetchers ──────────────────────────────────────────────────

async function fetchNpmLatest(): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE}/latest`, {
      signal: AbortSignal.timeout(6000),
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { version?: string }
    return typeof data.version === 'string' ? data.version : null
  } catch { return null }
}

async function fetchGitHubLatest(): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      signal: AbortSignal.timeout(6000),
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { tag_name?: string }
    return typeof data.tag_name === 'string' ? data.tag_name.replace(/^v/, '') : null
  } catch { return null }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Check npm AND GitHub for a newer version.
 * Uses a 6-hour file cache to avoid hammering the registry on every launch.
 * Returns an UpdateInfo if an update is available, otherwise null.
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  const installMethod = detectInstallMethod()

  // Return cached result if still fresh
  const cache = readCache()
  if (cache && Date.now() - cache.checkedAt < CHECK_INTERVAL) {
    if (cache.latestVersion && semverGt(cache.latestVersion, currentVersion)) {
      return {
        latestVersion: cache.latestVersion,
        installMethod: cache.installMethod,
        updateCommand: updateCommandFor(cache.installMethod),
      }
    }
    return null
  }

  // Fetch from both sources in parallel; take the highest version found
  const [npmVer, ghVer] = await Promise.all([
    fetchNpmLatest(),
    fetchGitHubLatest(),
  ])

  let latest: string | null = null
  if (npmVer && (!latest || semverGt(npmVer, latest))) latest = npmVer
  if (ghVer  && (!latest || semverGt(ghVer,  latest))) latest = ghVer

  writeCache({ checkedAt: Date.now(), latestVersion: latest, installMethod })

  if (latest && semverGt(latest, currentVersion)) {
    return {
      latestVersion: latest,
      installMethod,
      updateCommand: updateCommandFor(installMethod),
    }
  }
  return null
}
