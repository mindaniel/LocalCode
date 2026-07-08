import { Message, LLMConfig, LLMProvider } from '../shared/types'
import { OllamaProvider } from './providers/OllamaProvider'
import { LMStudioProvider } from './providers/LMStudioProvider'
import { LlamaCppProvider } from './providers/LlamaCppProvider'

const ollama   = new OllamaProvider()
const lmstudio = new LMStudioProvider()
const llamacpp = new LlamaCppProvider()

export class LLMRouter {
  static async stream(
    messages: Message[],
    config: LLMConfig,
    onToken: (token: string) => void
  ): Promise<{ response: string; totalTokens?: number }> {
    switch (config.provider) {
      case 'ollama':
        return ollama.stream(messages, config, onToken)
      case 'lmstudio':
        return lmstudio.stream(messages, config, onToken)
      case 'llamacpp':
        return llamacpp.stream(messages, config, onToken)
      default:
        throw new Error(`Unknown provider: ${config.provider}. Use "ollama", "lmstudio" or "llamacpp".`)
    }
  }

  static getOllamaProvider():   OllamaProvider   { return ollama }
  static getLMStudioProvider(): LMStudioProvider { return lmstudio }
  static getLlamaCppProvider(): LlamaCppProvider { return llamacpp }

  /** Generic accessor — returns the provider matching the given id, used for shared list/health logic. */
  static getProvider(id: LLMProvider): OllamaProvider | LMStudioProvider | LlamaCppProvider {
    switch (id) {
      case 'ollama':   return ollama
      case 'lmstudio': return lmstudio
      case 'llamacpp': return llamacpp
    }
  }
}
