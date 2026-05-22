import React from 'react'
import { Box, Text } from 'ink'
import { AgentMessage } from '../shared/types'
import { parseThinking } from '../shared/utils'
import { MarkdownText } from './MarkdownText'

export const MsgRow: React.FC<{
  msg: AgentMessage
  maxLines?: number
  debugMode?: boolean
  expanded?: boolean
  focused?: boolean
  thinkingExpanded?: boolean
  onToggleThinking?: () => void
}> = ({ msg, maxLines, debugMode, expanded, focused, thinkingExpanded, onToggleThinking }) => {
  switch (msg.type) {
    case 'thinking': {
      const allText = msg.content.trim().replace(/\s+/g, ' ')
      if (!allText) return null
      return (
        <Text color="#4B5563" dimColor italic wrap="truncate-start">
          {allText}
        </Text>
      )
    }
    case 'text':
      return <MarkdownText content={msg.content} />
    case 'command': {
      const lines = msg.content.split('\n')
      return (
        <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
          {msg.commandTitle && (
            <Box marginBottom={0}>
              <Text color="#6B7280">┌─ </Text>
              <Text color="#9CA3AF" bold>
                {msg.commandTitle}
              </Text>
            </Box>
          )}
          <Box
            flexDirection="column"
            borderStyle="single"
            borderColor="#374151"
            paddingX={1}
          >
            {lines.map((line, i) => {
              if (
                line.startsWith('  /') ||
                line.startsWith('  $') ||
                line.startsWith('  !')
              ) {
                const spaceIdx = line.search(/\s{2,}/)
                const cmd = spaceIdx > 0 ? line.slice(0, spaceIdx) : line
                const desc = spaceIdx > 0 ? line.slice(spaceIdx).trim() : ''
                return (
                  <Box key={i}>
                    <Text color="#3B82F6">{cmd}</Text>
                    {desc ? <Text color="#6B7280"> {desc}</Text> : null}
                  </Box>
                )
              }
              if (line.startsWith('**') && line.endsWith('**')) {
                return (
                  <Text key={i} color="#9CA3AF" bold>
                    {line.replace(/\*\*/g, '')}
                  </Text>
                )
              }
              if (line === '') return <Text key={i}> </Text>
              const isKv = /^\s{2}\S.*\s:\s/.test(line)
              if (isKv) {
                const colonIdx = line.indexOf(' : ')
                const key = line.slice(0, colonIdx)
                const val = line.slice(colonIdx + 3)
                return (
                  <Box key={i}>
                    <Text color="#6B7280">{key} </Text>
                    <Text color="#374151">: </Text>
                    <Text color="#E5E7EB">{val}</Text>
                  </Box>
                )
              }
              return (
                <Text key={i} color="#9CA3AF">
                  {line}
                </Text>
              )
            })}
          </Box>
        </Box>
      )
    }
    case 'tool_call': {
      if (!msg.toolCall) return null
      const a = msg.toolCall.arguments
      const cols = process.stdout.columns || 80
      const maxPath = Math.max(20, cols - 20)
      const tp = (s: unknown) => {
        const str = String(s || '')
        return str.length > maxPath ? '…' + str.slice(-(maxPath - 1)) : str
      }
      const label = (() => {
        switch (msg.toolCall.tool) {
          case 'run_shell':
            return `$ ${String(a.command || '').slice(0, cols - 10)}`
          case 'read_file':
            return `Read  ${tp(a.path)}`
          case 'write_file':
            return `Write  ${tp(a.path)}`
          case 'append_file':
            return `Append  ${tp(a.path)}`
          case 'edit_file':
            return null
          case 'delete_file':
            return `Delete  ${tp(a.path)}`
          case 'move_file':
            return `Move  ${tp(a.from)}  →  ${tp(a.to)}`
          case 'copy_file':
            return `Copy  ${tp(a.from)}  →  ${tp(a.to)}`
          case 'create_dir':
            return `mkdir  ${tp(a.path)}`
          case 'list_files':
            return `ls  ${tp(a.path || '.')}`
          case 'find_files':
            return `find  ${tp(a.pattern)}`
          case 'search_files':
            return `grep  "${tp(a.pattern)}"`
          case 'git_status':
            return 'git status'
          case 'git_diff':
            return 'git diff'
          case 'git_log':
            return 'git log'
          case 'git_commit':
            return `git commit  "${String(a.message || '').slice(0, 40)}"`
          case 'git_branch':
            return `git branch  ${String(a.action || 'list')}${a.name ? `  ${tp(a.name)}` : ''}`
          case 'git_stash':
            return `git stash  ${String(a.action || 'push')}${a.message ? `  "${String(a.message).slice(0, 30)}"` : ''}`
          case 'run_tests':
            return 'run tests'
          case 'web_fetch':
            return `fetch  ${tp(a.url)}`
          case 'http_request':
            return `${a.method || 'GET'}  ${tp(a.url)}`
          case 'lsp_check':
            return `lsp  ${tp(a.path || '.')}`
          case 'lsp_hover':
            return `hover  ${tp(a.path)}:${a.line}:${a.col}`
          case 'lsp_definition':
            return `def  ${tp(a.path)}:${a.line}:${a.col}`
          default:
            return msg.toolCall.tool
        }
      })()
      if (!label) return null
      return (
        <Box flexDirection="column" paddingLeft={1}>
          <Box flexDirection="row">
            <Text color="#374151"> </Text>
            <Text color="#6B7280" wrap="truncate-end">
              {label}
            </Text>
          </Box>
          {debugMode && (
            <Box paddingLeft={2}>
              <Text color="#374151" dimColor wrap="wrap">
                {JSON.stringify(msg.toolCall!.arguments).slice(0, 300)}
              </Text>
            </Box>
          )}
        </Box>
      )
    }
    case 'tool_result': {
      if (!msg.toolCall) return null
      if (msg.toolCall.tool === 'edit_file') return null
      if (msg.toolCall.tool === 'write_file' && msg.toolResult?.meta?.diffPath) return null
      if (!msg.toolResult?.success) {
        const errText = (msg.toolResult?.error || 'error').split('\n')[0]
        return (
          <Box flexDirection="row" paddingLeft={1}>
            <Text color="#EF4444" wrap="truncate-end">
              {' '}
              ✗ {errText}
            </Text>
          </Box>
        )
      }
      const outLines = (msg.toolResult.output || '')
        .split('\n')
        .filter(Boolean)
      const summary =
        outLines.length > 1
          ? `${outLines.length} lines`
          : (outLines[0] || '').slice(0, 60)
      if (!summary) return null
      if (expanded) {
        const showLines = outLines.slice(0, 30)
        return (
          <Box flexDirection="column" paddingLeft={1}>
            <Box flexDirection="row">
              <Text color={focused ? '#3B82F6' : '#374151'}>{focused ? '▶ ' : '  '}</Text>
              <Text color="#22C55E" wrap="truncate-end">▾ {summary}</Text>
            </Box>
            {showLines.map((line, i) => (
              <Box key={i} paddingLeft={2}>
                <Text color="#6B7280" wrap="truncate-end">{line}</Text>
              </Box>
            ))}
            {outLines.length > 30 && (
              <Box paddingLeft={2}>
                <Text color="#374151">… {outLines.length - 30} more lines</Text>
              </Box>
            )}
          </Box>
        )
      }
      return (
        <Box flexDirection="row" paddingLeft={1}>
          <Text color={focused ? '#3B82F6' : '#374151'}>{focused ? '▶ ' : '  '}</Text>
          <Text color={focused ? '#93C5FD' : '#4B5563'} wrap="truncate-end">
            ▸ {summary}
          </Text>
        </Box>
      )
    }
    case 'debug':
      return (
        <Box paddingLeft={1}>
          <Text color="#7C3AED" dimColor>[dbg] {msg.content}</Text>
        </Box>
      )
    case 'error': {
      const isConnErr =
        msg.content.includes('ECONNREFUSED') ||
        msg.content.includes('ENOTFOUND') ||
        msg.content.includes('fetch failed') ||
        msg.content.includes('connect ECONNREFUSED') ||
        msg.content.toLowerCase().includes('not reachable')
      return (
        <Box flexDirection="column">
          <Text color="#EF4444" wrap="wrap">
            {' '}
            ✗ {msg.content}
          </Text>
          {isConnErr && (
            <Text color="#F59E0B">
              {'   '}Tip: run /doctor to check your connection, or /connect to change provider
            </Text>
          )}
        </Box>
      )
    }
    case 'done': {
      const { thinking: doneThinking, response: doneResponse } = parseThinking(
        msg.content,
      )
      let clean = doneResponse
        .replace(/```json[\s\S]*?```/gi, '')
        .replace(/\s*DONE:\s*<[^>]*>/gi, '')
        .replace(/(?:^|\n)DONE:\s*/gi, '\n')
        .trim()
      // Truncate at tool call JSON (only when it starts a new line)
      const toolCallIdx = clean.search(/(?:^|\n)\s*\{"tool"\s*:/)
      if (toolCallIdx !== -1) clean = clean.slice(0, toolCallIdx).trim()
      if (!clean && !doneThinking) return null
      const thinkText = doneThinking?.trim() ?? ''
      const ThinkingLine = thinkText ? (
        <Box marginBottom={0} flexDirection="column">
          <Box onClick={onToggleThinking}>
            <Text color="#6366F1" bold>{thinkingExpanded ? '▼ ' : '▶ '}Reasoning </Text>
            {!thinkingExpanded && (
              <Text color="#6B7280" italic wrap="truncate-start">
                {thinkText.replace(/\s+/g, ' ')}
              </Text>
            )}
          </Box>
          {thinkingExpanded && (
            <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
              <MarkdownText content={thinkText} />
            </Box>
          )}
        </Box>
      ) : null

      if (maxLines) {
        const allLines = clean.split('\n')
        if (allLines.length > maxLines) {
          const hidden = allLines.length - maxLines
          clean = allLines.slice(0, maxLines).join('\n')
          return (
            <Box flexDirection="column">
              {ThinkingLine}
              <MarkdownText content={clean} />
              <Text color="#4B5563"> ↓ {hidden} more lines…</Text>
            </Box>
          )
        }
      }
      return (
        <Box flexDirection="column">
          {ThinkingLine}
          {clean ? <MarkdownText content={clean} /> : null}
        </Box>
      )
    }
    default:
      return null
  }
}
