import React from 'react'
import { Box, Text } from 'ink'
import { AgentMessage } from '../shared/types'
import { fmtTime } from '../shared/utils'
import { DiffView } from './DiffView'
import { MsgRow } from './MsgRow'

export const AgentBlock: React.FC<{
  messages: AgentMessage[]
  model: string
  maxLines?: number
  debugMode?: boolean
  expandedResults: Set<string>
  focusedToolId: string | null
  expandedThinking: Set<string>
  onToggleThinking: (id: string) => void
}> = ({ messages, model, maxLines, debugMode, expandedResults, focusedToolId, expandedThinking, onToggleThinking }) => {
  type Section =
    | { type: 'content'; msgs: AgentMessage[] }
    | { type: 'diff'; msg: AgentMessage }
  const sections: Section[] = []
  let buf: AgentMessage[] = []

  const flushBuf = () => {
    if (buf.length) {
      sections.push({ type: 'content', msgs: buf })
      buf = []
    }
  }

  for (const msg of messages) {
    if (
      msg.type === 'tool_result' &&
      (msg.toolCall?.tool === 'edit_file' || msg.toolCall?.tool === 'write_file') &&
      msg.toolResult?.meta?.diffPath
    ) {
      flushBuf()
      sections.push({ type: 'diff', msg })
    } else {
      buf.push(msg)
    }
  }
  flushBuf()

  const doneMsg = messages.find((m) => m.type === 'done')
  const ts = doneMsg?.timestamp ?? messages[messages.length - 1]?.timestamp

  const hasContent = messages.some(
    (m) =>
      (m.type === 'text' && m.content && !m.content.startsWith('> ')) ||
      m.type === 'error' ||
      (m.type === 'done' && m.content) ||
      (m.type === 'tool_result' && (m.toolCall?.tool === 'edit_file' || m.toolCall?.tool === 'write_file')),
  )

  return (
    <Box flexDirection="column" marginBottom={1}>
      {sections.map((sec, i) => {
        if (sec.type === 'diff') {
          const m = sec.msg.toolResult!.meta!
          return (
            <DiffView
              key={i}
              filePath={m.diffPath!}
              oldLines={m.diffOld!}
              newLines={m.diffNew!}
              startLine={m.diffStartLine!}
              contextBefore={m.diffContextBefore ?? []}
              contextAfter={m.diffContextAfter ?? []}
              isNew={m.diffIsNew}
            />
          )
        }
        const isLast = i === sections.length - 1
        return (
          <Box key={i}>
            <Text color="#3B82F6"> │ </Text>
            <Box flexDirection="column" flexGrow={1} minWidth={0} overflow="hidden">
              {sec.msgs.map((msg, mi) => (
                <MsgRow
                  key={msg.id}
                  msg={msg}
                  maxLines={
                    isLast && mi === sec.msgs.length - 1 ? maxLines : undefined
                  }
                  debugMode={debugMode}
                  expanded={expandedResults.has(msg.id)}
                  focused={msg.id === focusedToolId}
                  thinkingExpanded={expandedThinking.has(msg.id)}
                  onToggleThinking={() => onToggleThinking(msg.id)}
                />
              ))}
              {isLast && hasContent && ts && (
                <Box marginTop={0}>
                  <Text color="#374151">{model}</Text>
                  <Text color="#1D4ED8"> </Text>
                  <Text color="#374151">({fmtTime(ts)})</Text>
                  {(() => {
                    const doneMsgInner = messages.find((m) => m.type === 'done')
                    const parts: string[] = []
                    if (doneMsgInner?.durationMs) {
                      parts.push(`${(doneMsgInner.durationMs / 1000).toFixed(1)}s`)
                    }
                    if (doneMsgInner?.tokenCount) {
                      const t = doneMsgInner.tokenCount
                      parts.push(t >= 1000 ? `${(t / 1000).toFixed(1).replace(/\.0$/, '')}k tokens` : `${t} tokens`)
                    }
                    return parts.length > 0 ? (
                      <Text color="#374151"> {parts.join('  ')}</Text>
                    ) : null
                  })()}
                </Box>
              )}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
