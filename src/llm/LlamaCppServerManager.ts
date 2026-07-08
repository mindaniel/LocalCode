import { spawn, exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { LlamaCppServerConfig } from '../shared/types'
import { LlamaCppProvider } from './providers/LlamaCppProvider'
import { ensureLlamaServerBinary, ensureDefaultModel, defaultModelPath } from './LlamaCppDownloader'

const execAsync = promisify(exec)
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

/** Throws if a model path was explicitly configured but doesn't exist, rather than silently
 *  falling back to the auto-downloaded default — a wrong/mistyped path should be a loud error. */
function resolveModelPath(server: LlamaCppServerConfig | undefined, installDir: string): string {
  if (server?.modelPath) {
    if (!fs.existsSync(server.modelPath)) {
      throw new Error(`Configured model not found: ${server.modelPath}`)
    }
    return server.modelPath
  }
  return defaultModelPath(installDir)
}

/** Same principle for an explicitly configured binary path. */
function resolveBinaryPath(server: LlamaCppServerConfig | undefined): string | undefined {
  if (server?.binaryPath) {
    if (!fs.existsSync(server.binaryPath)) {
      throw new Error(`Configured llama-server binary not found: ${server.binaryPath}`)
    }
    return server.binaryPath
  }
  return undefined
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

/** Asks the live server what model it actually has loaded (from /v1/models), independent of our own bookkeeping. */
async function getLiveModelId(baseURL: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseURL.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    const json = (await res.json()) as { data?: Array<{ id: string }> }
    return json.data?.[0]?.id ?? null
  } catch {
    return null
  }
}

/** Finds the PID of whatever's listening on a port, but only Windows for now (netstat parsing). */
async function findListeningPid(port: string): Promise<number | null> {
  if (process.platform !== 'win32') return null
  try {
    const { stdout } = await execAsync('netstat -ano -p tcp')
    for (const line of stdout.split('\n')) {
      if (new RegExp(`[:.]${port}\\s`).test(line) && /LISTENING/i.test(line)) {
        const parts = line.trim().split(/\s+/)
        const pid = parseInt(parts[parts.length - 1], 10)
        if (!isNaN(pid)) return pid
      }
    }
  } catch {}
  return null
}

/** Confirms a PID is actually llama-server before we touch it — never kill an unidentified process. */
async function isLlamaServerPid(pid: number): Promise<boolean> {
  try {
    const cmd =
      process.platform === 'win32'
        ? `tasklist /FI "PID eq ${pid}" /FO CSV /NH`
        : `ps -p ${pid} -o comm=`
    const { stdout } = await execAsync(cmd)
    return /llama-server/i.test(stdout)
  } catch {
    return false
  }
}

/**
 * Ensures a llama.cpp server is reachable at the configured baseURL, serving the
 * configured model with the configured extra args (context size, threads, etc).
 * The live server's /v1/models response is always checked against what's configured
 * (not just our own state-file bookkeeping) — so a mismatch is caught and fixed even
 * if the running server predates this tracking or its state file was lost. We only
 * ever kill a process we've positively identified as llama-server (by PID from our
 * own records, or by confirming the image name via tasklist/ps) — never anything
 * merely guessed to be listening on the port.
 * The server is intentionally left running after LocalCode exits — see README
 * for how to stop it manually.
 */
export async function ensureLlamaCppRunning(
  server: LlamaCppServerConfig | undefined,
  baseURL: string,
  onProgress?: ProgressCallback,
): Promise<EnsureRunningResult> {
  const installDir = installDirOf(server)

  try {
    const desiredModelPath = resolveModelPath(server, installDir)
    resolveBinaryPath(server) // throws early if configured but missing
    const desiredPort = server?.port || '8080'
    const desiredExtraArgs = server?.extraArgs || ''

    onProgress?.('Checking for a running llama.cpp server…')
    const isHealthy = await provider.checkHealth(baseURL)

    if (isHealthy) {
      const state = readState(installDir)
      const stateMatches =
        !!state &&
        state.modelPath === desiredModelPath &&
        state.port === desiredPort &&
        state.extraArgs === desiredExtraArgs

      const liveModelId = await getLiveModelId(baseURL)
      const liveMatches = liveModelId === null || path.basename(liveModelId) === path.basename(desiredModelPath)

      if (liveMatches && (!state || stateMatches)) {
        // Serving what we want, whether or not we recognize the process managing it.
        return { ok: true, alreadyRunning: true, baseURL, modelPath: liveModelId ?? desiredModelPath }
      }

      onProgress?.(`Config changed → restarting llama-server with ${path.basename(desiredModelPath)}…`)
      let killedSomething = false
      if (state) {
        killPid(state.pid)
        killedSomething = true
      } else {
        const pid = await findListeningPid(desiredPort)
        if (pid && (await isLlamaServerPid(pid))) {
          killPid(pid)
          killedSomething = true
        }
      }

      if (!killedSomething) {
        return {
          ok: false,
          alreadyRunning: true,
          baseURL,
          modelPath: liveModelId ?? undefined,
          error:
            `A server at ${baseURL} is serving "${liveModelId}", not the configured model ` +
            `"${path.basename(desiredModelPath)}", and it isn't one LocalCode can safely identify/stop ` +
            `(not llama-server, or already gone). Stop it manually, then relaunch.`,
        }
      }
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

    const binaryPath = resolveBinaryPath(server) ?? (await ensureLlamaServerBinary(installDir, onProgress))
    // desiredModelPath was already validated above when explicitly configured; only the
    // no-config default case still needs to actually trigger the download.
    const modelPath = server?.modelPath ? desiredModelPath : await ensureDefaultModel(installDir, onProgress)

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
