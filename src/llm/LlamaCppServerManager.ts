import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { LlamaCppServerConfig } from '../shared/types'
import { LlamaCppProvider } from './providers/LlamaCppProvider'
import { ensureLlamaServerBinary, ensureDefaultModel, defaultModelPath } from './LlamaCppDownloader'

const provider = new LlamaCppProvider()

export interface EnsureRunningResult {
  ok: boolean
  alreadyRunning: boolean
  baseURL: string
  binaryPath?: string
  modelPath?: string
  error?: string
}

export type ProgressCallback = (message: string) => void

interface ServerState {
  pid: number
  modelPath: string
  port: string
  extraArgs: string
}

function installDirOf(server?: LlamaCppServerConfig): string {
  return server?.installDir || path.join(os.homedir(), '.localcode', 'llamacpp')
}

function stateFilePath(installDir: string): string {
  return path.join(installDir, 'server-state.json')
}

function readState(installDir: string): ServerState | null {
  try {
    return JSON.parse(fs.readFileSync(stateFilePath(installDir), 'utf-8'))
  } catch {
    return null
  }
}

function writeState(installDir: string, state: ServerState): void {
  try {
    fs.mkdirSync(installDir, { recursive: true })
    fs.writeFileSync(stateFilePath(installDir), JSON.stringify(state, null, 2))
  } catch {}
}

function resolveModelPath(server: LlamaCppServerConfig | undefined, installDir: string): string {
  if (server?.modelPath && fs.existsSync(server.modelPath)) return server.modelPath
  return defaultModelPath(installDir)
}

async function waitForHealth(baseURL: string, timeoutMs: number, expectHealthy: boolean): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if ((await provider.checkHealth(baseURL)) === expectHealthy) return true
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

function killPid(pid: number): void {
  try {
    process.kill(pid)
  } catch {}
}

/**
 * Ensures a llama.cpp server is reachable at the configured baseURL, serving the
 * configured model with the configured extra args (context size, threads, etc).
 * If a server we previously spawned is running with *different* settings than
 * currently configured, it is restarted. Servers we don't recognize (no state
 * file — e.g. started manually by the user) are left alone and used as-is.
 * The server is intentionally left running after LocalCode exits — see README
 * for how to stop it manually.
 */
export async function ensureLlamaCppRunning(
  server: LlamaCppServerConfig | undefined,
  baseURL: string,
  onProgress?: ProgressCallback,
): Promise<EnsureRunningResult> {
  const installDir = installDirOf(server)
  const desiredModelPath = resolveModelPath(server, installDir)
  const desiredPort = server?.port || '8080'
  const desiredExtraArgs = server?.extraArgs || ''

  onProgress?.('Checking for a running llama.cpp server…')
  const isHealthy = await provider.checkHealth(baseURL)

  if (isHealthy) {
    const state = readState(installDir)
    const matches =
      !!state &&
      state.modelPath === desiredModelPath &&
      state.port === desiredPort &&
      state.extraArgs === desiredExtraArgs
    if (!state || matches) {
      // Either not a server we manage, or already serving with the right settings — leave it.
      return { ok: true, alreadyRunning: true, baseURL, modelPath: state?.modelPath ?? desiredModelPath }
    }
    onProgress?.(`Config changed → restarting llama-server with ${path.basename(desiredModelPath)}…`)
    killPid(state.pid)
    await waitForHealth(baseURL, 10000, false)
  }

  if (server?.autoStart === false) {
    return {
      ok: false,
      alreadyRunning: false,
      baseURL,
      error: 'No llama.cpp server reachable and autoStart is disabled.',
    }
  }

  try {
    const binaryPath =
      server?.binaryPath && fs.existsSync(server.binaryPath)
        ? server.binaryPath
        : await ensureLlamaServerBinary(installDir, onProgress)

    const modelPath =
      server?.modelPath && fs.existsSync(server.modelPath)
        ? server.modelPath
        : await ensureDefaultModel(installDir, onProgress)

    const port = server?.port || '8080'
    const args = [
      '-m', modelPath,
      '--port', port,
      '--host', '127.0.0.1',
      ...(server?.extraArgs ? server.extraArgs.split(/\s+/).filter(Boolean) : []),
    ]

    onProgress?.('Starting llama-server…')
    // detached on both platforms so the server outlives this process (e.g. survives Ctrl+C / exit),
    // and isn't torn down as part of the parent's job object / process group on Windows.
    const child = spawn(binaryPath, args, {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    })
    child.unref()

    const healthy = await waitForHealth(baseURL, 45000, true)
    if (!healthy) {
      return {
        ok: false,
        alreadyRunning: false,
        baseURL,
        binaryPath,
        modelPath,
        error: 'llama-server did not become reachable within 45s',
      }
    }

    if (child.pid) writeState(installDir, { pid: child.pid, modelPath, port, extraArgs: server?.extraArgs || '' })

    return { ok: true, alreadyRunning: false, baseURL, binaryPath, modelPath }
  } catch (e) {
    return { ok: false, alreadyRunning: false, baseURL, error: String(e) }
  }
}
