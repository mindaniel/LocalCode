export type JSONSchema = Record<string, unknown>

export interface ToolDefinition {
  name: string
  description: string
  parameters: JSONSchema
  execute: (args: Record<string, unknown>) => Promise<string>
  pluginName?: string
}

export interface PluginCommandResult {
  type: 'text' | 'error' | 'done' | 'command'
  content: string
  title?: string
}

export interface PluginCommand {
  cmd: string
  description: string
  handler: (args: string, ctx: { cwd: string }) => Promise<PluginCommandResult>
}

export interface PluginManifest {
  name: string
  version: string
  description: string
  author: string
  tools: string[]
  commands?: string[]
}

export interface PluginLoadResult {
  name: string
  success: boolean
  toolCount?: number
  commands?: PluginCommand[]
  error?: string
}
