import { ToolResult } from '../../shared/types'
import { ConfigManager } from '../../config/ConfigManager'
import { LLMRouter } from '../../llm/LLMRouter'

export async function askAgentTool(name: string, prompt: string): Promise<ToolResult> {
  if (!name) return { success: false, output: '', error: 'ask_agent: "agent" is required.' }
  if (!prompt) return { success: false, output: '', error: 'ask_agent: "prompt" is required.' }

  const cfg = ConfigManager.getInstance().get()
  const agents = cfg.llamaCppAgents ?? {}
  const agent = agents[name]
  if (!agent) {
    const available = Object.keys(agents)
    return {
      success: false,
      output: '',
      error: available.length
        ? `ask_agent: no agent named "${name}". Available: ${available.join(', ')}`
        : `ask_agent: no agent named "${name}". No agents configured — set one with /config llamacpp agent <name> model <path>.`,
    }
  }

  const port = agent.port || '8080'
  const baseURL = `http://localhost:${port}/v1`

  const { ensureLlamaCppRunning } = await import('../../llm/LlamaCppServerManager.js')
  const started = await ensureLlamaCppRunning(agent, baseURL, undefined, name)
  if (!started.ok) {
    return { success: false, output: '', error: `ask_agent: couldn't reach "${name}" — ${started.error}` }
  }

  try {
    let response = ''
    const result = await LLMRouter.stream(
      [
        { role: 'system', content: 'You are a helpful assistant. Answer directly and concisely.' },
        { role: 'user', content: prompt },
      ],
      { provider: 'llamacpp', model: agent.modelPath || name, baseURL, temperature: cfg.llm.temperature },
      (token) => { response += token },
    )
    return { success: true, output: `[${name}] ${result.response || response}` }
  } catch (err) {
    return { success: false, output: '', error: `ask_agent: request to "${name}" failed — ${String(err)}` }
  }
}
