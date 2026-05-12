import type { ToolDefinition, JSONSchema, PluginCommand } from '../types/plugin.js'

export interface OpenAITool {
  type: 'function'
  function: { name: string; description: string; parameters: JSONSchema }
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>()

  addTool(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      const prev = this.tools.get(tool.name)!.pluginName ?? 'core'
      const next = tool.pluginName ?? 'unknown'
      console.warn(`[plugins] Tool "${tool.name}" already registered by "${prev}" — overwritten by "${next}"`)
    }
    this.tools.set(tool.name, tool)
  }

  removeTool(name: string): void { this.tools.delete(name) }

  getTool(name: string): ToolDefinition | undefined { return this.tools.get(name) }

  listTools(): ToolDefinition[] { return [...this.tools.values()] }

  removePluginTools(pluginName: string): void {
    for (const [name, tool] of this.tools) {
      if (tool.pluginName === pluginName) this.tools.delete(name)
    }
  }

  toOpenAIFormat(): OpenAITool[] {
    return this.listTools().map(t => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }))
  }

  async executeTool(name: string, args: unknown): Promise<string> {
    const tool = this.tools.get(name)
    if (!tool) return `Error: unknown tool "${name}"`
    try {
      return await tool.execute(args as Record<string, unknown>)
    } catch (err) {
      return `Error executing "${name}": ${String(err)}`
    }
  }
}

export class CommandRegistry {
  private cmds = new Map<string, PluginCommand>()
  private owners = new Map<string, string>()

  addCommand(cmd: PluginCommand, pluginName?: string): void {
    if (this.cmds.has(cmd.cmd)) {
      const prev = this.owners.get(cmd.cmd) ?? 'unknown'
      const next = pluginName ?? 'unknown'
      console.warn(`[plugins] Command "${cmd.cmd}" already registered by "${prev}" — overwritten by "${next}"`)
    }
    this.cmds.set(cmd.cmd, cmd)
    if (pluginName) this.owners.set(cmd.cmd, pluginName)
  }

  removeCommand(cmdStr: string): void {
    this.cmds.delete(cmdStr)
    this.owners.delete(cmdStr)
  }

  removePluginCommands(pluginName: string): void {
    for (const [key, owner] of this.owners) {
      if (owner === pluginName) {
        this.cmds.delete(key)
        this.owners.delete(key)
      }
    }
  }

  listCommands(): PluginCommand[] { return [...this.cmds.values()] }

  getCommand(input: string): PluginCommand | undefined {
    const trimmed = input.trim()
    for (const cmd of this.cmds.values()) {
      const key = cmd.cmd.trimEnd()
      if (trimmed === key || trimmed.startsWith(key + ' ')) return cmd
    }
    return undefined
  }
}

export const globalRegistry = new ToolRegistry()
export const globalCommandRegistry = new CommandRegistry()
