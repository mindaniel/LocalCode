import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { pipeline } from 'stream/promises'
import AdmZip from 'adm-zip'

const DEFAULT_INSTALL_DIR = path.join(os.homedir(), '.localcode', 'llamacpp')

const GITHUB_LATEST_RELEASE_API = 'https://api.github.com/repos/ggml-org/llama.cpp/releases/latest'

// Small, fast, CPU-friendly default so a first run works with no GPU and modest RAM.
export const DEFAULT_MODEL_NAME = 'qwen2.5-0.5b-instruct-q4_k_m.gguf'
const DEFAULT_MODEL_URL =
  'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf'

export type ProgressCallback = (message: string) => void

function pickAssetName(): string {
  const plat = process.platform
  const arch = process.arch
  if (plat === 'win32') return arch === 'arm64' ? 'bin-win-cpu-arm64.zip' : 'bin-win-cpu-x64.zip'
  if (plat === 'darwin') return arch === 'arm64' ? 'bin-macos-arm64.zip' : 'bin-macos-x64.zip'
  return 'bin-ubuntu-x64.zip' // linux fallback
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': 'localcode-agent' } })
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`)
  return res.json() as Promise<T>
}

async function downloadToFile(url: string, dest: string, onProgress?: ProgressCallback): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download failed ${res.status}: ${url}`)

  const total = Number(res.headers.get('content-length') || 0)
  let received = 0
  const fileStream = fs.createWriteStream(dest)

  const reader = (res.body as unknown as ReadableStream<Uint8Array>).getReader()
  await pipeline(
    (async function* () {
      while (true) {
        const { done, value } = await reader.read()
        if (done) return
        received += value.byteLength
        if (onProgress && total > 0) {
          onProgress(`${((received / total) * 100).toFixed(0)}%`)
        }
        yield value
      }
    })(),
    fileStream,
  )
}

/** Ensures a llama-server binary exists locally, downloading the latest release if needed. Returns the exe path. */
export async function ensureLlamaServerBinary(installDir = DEFAULT_INSTALL_DIR, onProgress?: ProgressCallback): Promise<string> {
  const binDir = path.join(installDir, 'bin')
  const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  const exePath = path.join(binDir, exeName)
  if (fs.existsSync(exePath)) return exePath

  fs.mkdirSync(binDir, { recursive: true })
  onProgress?.('Looking up latest llama.cpp release…')

  const release = await fetchJson<{ assets: { name: string; browser_download_url: string }[] }>(
    GITHUB_LATEST_RELEASE_API,
  )
  const suffix = pickAssetName()
  const asset = release.assets.find((a) => a.name.endsWith(suffix))
  if (!asset) throw new Error(`No llama.cpp release asset found for this platform (${suffix})`)

  const zipPath = path.join(installDir, asset.name)
  onProgress?.(`Downloading ${asset.name}…`)
  await downloadToFile(asset.browser_download_url, zipPath, (pct) => onProgress?.(`Downloading llama.cpp… ${pct}`))

  onProgress?.('Extracting llama.cpp…')
  new AdmZip(zipPath).extractAllTo(binDir, true)
  fs.unlinkSync(zipPath)

  if (!fs.existsSync(exePath)) {
    throw new Error(`Extracted archive did not contain ${exeName}`)
  }
  if (process.platform !== 'win32') fs.chmodSync(exePath, 0o755)
  return exePath
}

/** Default location a model would be downloaded to, without triggering a download. */
export function defaultModelPath(installDir = DEFAULT_INSTALL_DIR): string {
  return path.join(installDir, 'models', DEFAULT_MODEL_NAME)
}

/** Ensures a default small model is present locally, downloading it if needed. Returns the model path. */
export async function ensureDefaultModel(installDir = DEFAULT_INSTALL_DIR, onProgress?: ProgressCallback): Promise<string> {
  const modelPath = defaultModelPath(installDir)
  if (fs.existsSync(modelPath)) return modelPath

  fs.mkdirSync(path.dirname(modelPath), { recursive: true })
  onProgress?.(`Downloading default model (${DEFAULT_MODEL_NAME})…`)
  await downloadToFile(DEFAULT_MODEL_URL, modelPath, (pct) => onProgress?.(`Downloading model… ${pct}`))
  return modelPath
}
