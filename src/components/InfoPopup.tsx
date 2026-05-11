import React from 'react'
import { Box, Text } from 'ink'

interface InfoPopupProps {
  title: string
  content: string
  scroll: number
  termRows: number
  termCols: number
}

function renderLine(line: string, i: number, termCols: number): React.ReactElement {
  const maxW = termCols - 8
  if (!line.trim()) return <Text key={i}> </Text>

  if (/^\*\*.+\*\*$/.test(line.trim())) {
    return <Text key={i} color="#60A5FA" bold>{line.replace(/\*\*/g, '')}</Text>
  }

  const isKv = /^\s{2}\S.*\s:\s/.test(line)
  if (isKv) {
    const ci = line.indexOf(' : ')
    return (
      <Box key={i}>
        <Text color="#6B7280">{line.slice(0, ci)} </Text>
        <Text color="#374151">: </Text>
        <Text color="#E5E7EB">{line.slice(ci + 3).slice(0, maxW)}</Text>
      </Box>
    )
  }

  if (/^\s{2}[/$!\\]/.test(line)) {
    const si = line.search(/\s{2,}/, 2)
    const cmd  = si > 0 ? line.slice(0, si) : line
    const desc = si > 0 ? line.slice(si).trim() : ''
    return (
      <Box key={i}>
        <Text color="#3B82F6">{cmd}</Text>
        {desc ? <Text color="#4B5563">  {desc.slice(0, maxW - cmd.length)}</Text> : null}
      </Box>
    )
  }

  if (/^\s{2}\S/.test(line)) {
    return <Text key={i} color="#9CA3AF">{line.slice(0, maxW)}</Text>
  }

  return <Text key={i} color="#D1D5DB">{line.slice(0, maxW)}</Text>
}

export const InfoPopup: React.FC<InfoPopupProps> = ({ title, content, scroll, termRows, termCols }) => {
  const lines = content.split('\n')
  const bodyH = Math.max(4, termRows - 7)
  const clamped = Math.min(scroll, Math.max(0, lines.length - bodyH))
  const visible = lines.slice(clamped, clamped + bodyH)
  const above = clamped
  const below = Math.max(0, lines.length - clamped - bodyH)

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="#1E3A5F" marginX={1} marginBottom={0}>
      {/* Header */}
      <Box paddingX={1} justifyContent="space-between">
        <Text color="#3B82F6" bold> {title} </Text>
        <Text color="#4B5563">ESC close  ↑↓/PgUp/PgDn scroll </Text>
      </Box>
      <Box paddingX={1}><Text color="#1E3A5F">{'─'.repeat(Math.max(0, termCols - 6))}</Text></Box>

      {/* Scroll indicator top */}
      {above > 0
        ? <Box paddingX={2}><Text color="#F59E0B">↑ {above} more above</Text></Box>
        : <Box paddingX={2}><Text color="#1F2937"> </Text></Box>
      }

      {/* Content */}
      <Box flexDirection="column" paddingX={2} flexGrow={1}>
        {visible.map((line, i) => renderLine(line, i, termCols))}
      </Box>

      {/* Scroll indicator bottom */}
      {below > 0
        ? <Box paddingX={2}><Text color="#F59E0B">↓ {below} more below</Text></Box>
        : <Box paddingX={2}><Text color="#1F2937"> </Text></Box>
      }
    </Box>
  )
}
