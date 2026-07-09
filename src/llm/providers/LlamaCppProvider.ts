import { Message, LLMConfig } from '../../shared/types'

const DEFAULT_BASE_URL = 'http://localhost:8080/v1'

// No single request has a hard deadline — a large context legitimately can take a long
// time to prefill on CPU. Instead this is an *idle* timeout: if no new bytes arrive for
// this long (covering both "waiting for the first token" and "stalled mid-stream"), the
// request is aborted with a clear error rather than hanging silently forever.
const IDLE_TIMEOUT_MS = 15 * 60 * 1000

export class LlamaCppProvider {
  async stream(
    messages: Message[],
    config: LLMConfig,
    onToken: (token: string) => void
  ): Promise<{ response: string; totalTokens?: number }> {
    const baseURL = (config.baseURL || DEFAULT_BASE_URL).replace(/\/$/, '')
    let fullResponse = ''
    let totalTokens: number | undefined

    const controller = new AbortController()
    let idleTimer: ReturnType<typeof setTimeout>
    const resetIdleTimer = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS)
    }
    resetIdleTimer()

    let response: Response
    try {
      response = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: config.model || 'local-model',
          messages: messages.map(m => {
            if (!m.images?.length) return { role: m.role, content: m.content }
            return {
              role: m.role,
              content: [
                { type: 'text', text: m.content },
                ...m.images.map(img => ({
                  type: 'image_url',
                  image_url: { url: `data:image/png;base64,${img}` },
                })),
              ],
            }
          }),
          stream: true,
          // Reuse the KV cache for the unchanged prefix between turns instead of
          // reprocessing the whole growing conversation from scratch each time —
          // without this, agentic tool loops get slower and slower as history grows.
          cache_prompt: true,
          temperature: config.temperature ?? 0.1,
          max_tokens: config.maxTokens ?? 8192,
        }),
      })
    } catch (e) {
      clearTimeout(idleTimer)
      if (controller.signal.aborted) {
        throw new Error(
          `llama.cpp request timed out after ${IDLE_TIMEOUT_MS / 60000} minutes with no response. ` +
          `This usually means the CPU is too busy (another process competing for cores) or the ` +
          `context is too large to process in time — try again, free up CPU, or lower context length.`,
        )
      }
      throw e
    }

    if (!response.ok) {
      clearTimeout(idleTimer)
      const text = await response.text()
      throw new Error(`llama.cpp error ${response.status}: ${text}`)
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        resetIdleTimer()

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') return { response: fullResponse, totalTokens }

          try {
            const parsed = JSON.parse(data)
            const token = parsed.choices?.[0]?.delta?.content
            if (token) { onToken(token); fullResponse += token }
            if (parsed.usage?.total_tokens) {
              totalTokens = parsed.usage.total_tokens
            }
          } catch {}
        }
      }
    } catch (e) {
      if (controller.signal.aborted) {
        throw new Error(
          `llama.cpp stream stalled for ${IDLE_TIMEOUT_MS / 60000} minutes with no new data — aborted. ` +
          `CPU likely too busy, or context too large to process in time.`,
        )
      }
      throw e
    } finally {
      clearTimeout(idleTimer)
    }

    return { response: fullResponse, totalTokens }
  }

  async checkHealth(baseURL?: string): Promise<boolean> {
    try {
      const url = (baseURL || DEFAULT_BASE_URL).replace(/\/$/, '')
      const res = await fetch(`${url}/models`, { signal: AbortSignal.timeout(2000) })
      return res.ok
    } catch { return false }
  }

  async listModels(baseURL?: string): Promise<string[]> {
    try {
      const url = (baseURL || DEFAULT_BASE_URL).replace(/\/$/, '')
      const res = await fetch(`${url}/models`, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) return []
      const json = await res.json() as { data?: Array<{ id: string }> }
      return (json.data ?? []).map(m => m.id)
    } catch { return [] }
  }
}
