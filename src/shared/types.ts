export type LLMProvider = 'ollama' | 'lmstudio' | 'llamacpp'

export interface LLMConfig {
  provider: LLMProvider
  model: string
  baseURL?: string
  apiKey?: string
  temperature?: number
  maxTokens?: number
}

export interface LlamaCppServerConfig {
  autoStart?: boolean     // spawn llama-server automatically when provider is llamacpp (default true)
  binaryPath?: string     // path to llama-server(.exe); auto-downloaded if unset
  modelPath?: string      // path to a .gguf model; auto-downloaded if unset
  installDir?: string     // where to auto-download binary/model into (default ~/.localcode/llamacpp)
  modelsDir?: string      // a folder to browse for .gguf files via /models local, e.g. your LM Studio models folder
  port?: string           // default 8080
  extraArgs?: string      // extra CLI args passed to llama-server, space-separated
}

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  images?: string[]   // base64-encoded images for multimodal models
}

export interface Attachment {
  path: string
  name: string
  type: 'image' | 'file'
  data: string        // base64 for images, text content for files
  mimeType?: string
}

export interface ToolCall {
  tool: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  success: boolean
  output: string
  error?: string
  images?: string[]   // base64 screenshots / images returned by a tool
  meta?: {
    diffPath?: string
    diffOld?: string[]
    diffNew?: string[]
    diffStartLine?: number
    diffContextBefore?: string[]
    diffContextAfter?: string[]
    diffIsNew?: boolean   // true when the file was created (not updated)
  }
}

export interface AppConfig {
  llm: LLMConfig
  llamaCppServer?: LlamaCppServerConfig
  // Named llama.cpp server profiles, each independently startable/stoppable on its own
  // port — lets multiple models run concurrently (e.g. one for coding, one for quick
  // chat). Switch which one the active session talks to with /use <name>.
  llamaCppAgents?: Record<string, LlamaCppServerConfig>
  theme: 'dark'
  fontSize: number
  shell: string
  workspaceDir: string
  trustedPaths: string[]   // paths where write ops are auto-approved (+ all subpaths)
  disabledPlugins: string[]
  debugMode?: boolean
  security: {
    allowDangerousCommands: boolean
    requireConfirmation: string[]
  }
}

export interface AgentMessage {
  id: string
  type: 'thinking' | 'text' | 'command' | 'tool_call' | 'tool_result' | 'error' | 'done' | 'debug'
  content: string
  commandTitle?: string
  toolCall?: ToolCall
  toolResult?: ToolResult
  timestamp: number
  tokenCount?: number
  durationMs?: number
  debugInfo?: {
    iteration?: number
    tokens?: number
    elapsed?: number
    tool?: string
    success?: boolean
  }
}
