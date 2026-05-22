import { AgentMessage } from './types'
import { BUILTIN_COMMANDS, COMMAND_SUGGESTIONS } from './constants'

// ── Turn grouping ─────────────────────────────────────────────────────────────
export type Turn =
  | { type: 'user'; content: string; timestamp: number }
  | { type: 'agent'; messages: AgentMessage[] }

export function groupIntoTurns(messages: AgentMessage[]): Turn[] {
  const turns: Turn[] = []
  let agentMsgs: AgentMessage[] = []

  const flush = () => {
    if (agentMsgs.length > 0) {
      turns.push({ type: 'agent', messages: agentMsgs })
      agentMsgs = []
    }
  }

  for (const msg of messages) {
    if (msg.type === 'text' && msg.content.startsWith('> ')) {
      flush()
      turns.push({
        type: 'user',
        content: msg.content.slice(2),
        timestamp: msg.timestamp,
      })
    } else {
      agentMsgs.push(msg)
    }
  }
  flush()
  return turns
}

// ── Line-height estimation ────────────────────────────────────────────────────
export function countLines(text: string, width: number): number {
  return text
    .split('\n')
    .reduce(
      (s, l) =>
        s + Math.max(1, Math.ceil((l.length || 1) / Math.max(1, width))),
      0,
    )
}

export function estimateTurnLines(turn: Turn, innerWidth: number): number {
  if (turn.type === 'user') return 4 // box border + content + timestamp + margin

  let lines = 0
  for (const msg of turn.messages) {
    if (msg.type === 'error') {
      lines += countLines(msg.content, innerWidth)
    } else if (msg.type === 'command') {
      lines += msg.content.split('\n').length + (msg.commandTitle ? 1 : 0) + 2
    } else if (msg.type === 'text') {
      lines += countLines(msg.content, innerWidth)
    } else if (msg.type === 'done' && msg.content) {
      lines += countLines(
        msg.content.replace(/^DONE:\s*/i, '').trim(),
        innerWidth,
      )
    } else if (
      msg.type === 'tool_result' &&
      msg.toolCall?.tool === 'edit_file' &&
      msg.toolResult?.meta
    ) {
      const m = msg.toolResult.meta
      lines +=
        (m.diffContextBefore?.length ?? 0) +
        (m.diffOld?.length ?? 0) +
        (m.diffNew?.length ?? 0) +
        (m.diffContextAfter?.length ?? 0) +
        4
    } else {
      lines += 1
    }
  }
  return Math.max(2, lines + 2) // +1 footer, +1 margin
}

export function getVisibleTurns(
  turns: Turn[],
  availRows: number,
  innerWidth: number,
  scrollLines: number,
): { visible: Turn[]; hiddenAbove: number; hiddenBelow: number } {
  const heights = turns.map((t) => estimateTurnLines(t, innerWidth))
  const total = heights.reduce((s, h) => s + h, 0)

  // Viewport: the availRows-line window ending at (total - scrollLines)
  const viewEnd = Math.max(availRows, total - scrollLines)
  const viewStart = viewEnd - availRows

  const result: Turn[] = []
  let hiddenAbove = 0
  let hiddenBelow = 0
  let pos = 0

  for (let i = 0; i < turns.length; i++) {
    const h = heights[i]
    const turnEnd = pos + h
    // Skip turns that start before the viewport (including partial overlaps at top)
    // to avoid Ink rendering full turn content that overflows above the layout boundary
    if (pos < viewStart) hiddenAbove++
    else if (pos >= viewEnd) hiddenBelow++
    else result.push(turns[i])
    pos = turnEnd
  }

  return { visible: result, hiddenAbove, hiddenBelow }
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ── Thinking tag parser ───────────────────────────────────────────────────────
export function parseThinking(tokens: string): {
  thinking: string
  response: string
  stillThinking: boolean
} {
  let openTag = '<thinking>'
  let closeTag = '</thinking>'
  let start = tokens.indexOf(openTag)

  if (start === -1) {
    openTag = '<think>'
    closeTag = '</think>'
    start = tokens.indexOf(openTag)
  }

  if (start !== -1) {
    const before = tokens.slice(0, start).trim()
    const end = tokens.indexOf(closeTag, start)
    if (end === -1) {
      return {
        thinking: tokens.slice(start + openTag.length),
        response: before,
        stillThinking: true,
      }
    }
    const after = tokens.slice(end + closeTag.length).trimStart()
    return {
      thinking: tokens.slice(start + openTag.length, end),
      response: before + (before && after ? '\n\n' : '') + after,
      stillThinking: false,
    }
  }

  const closeThinking = tokens.indexOf('</thinking>')
  const closeThink = tokens.indexOf('</think>')

  if (closeThinking !== -1) {
    return {
      thinking: tokens.slice(0, closeThinking),
      response: tokens.slice(closeThinking + '</thinking>'.length).trimStart(),
      stillThinking: false,
    }
  }
  if (closeThink !== -1) {
    return {
      thinking: tokens.slice(0, closeThink),
      response: tokens.slice(closeThink + '</think>'.length).trimStart(),
      stillThinking: false,
    }
  }

  return { thinking: '', response: tokens, stillThinking: false }
}

// ── Autocomplete ──────────────────────────────────────────────────────────────
export function getSuggestion(input: string, history: string[]): string {
  if (input.length < 2) return ''
  const h = history.find(
    (s) => s !== input && s.toLowerCase().startsWith(input.toLowerCase()),
  )
  if (h) return h.slice(input.length)
  const c = BUILTIN_COMMANDS.find(
    (b) => b.cmd.startsWith(input) && b.cmd !== input,
  )
  if (c) return c.cmd.slice(input.length)
  const a = COMMAND_SUGGESTIONS.find((s) => s.startsWith(input) && s !== input)
  if (a) return a.slice(input.length)
  return ''
}
