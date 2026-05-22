import React from 'react'
import { Box, Text } from 'ink'
import { fmtTime } from '../shared/utils'

export const UserBlock: React.FC<{ content: string; timestamp: number }> = ({
  content,
  timestamp,
}) => (
  <Box
    flexDirection="column"
    marginBottom={1}
    marginX={1}
    borderStyle="single"
    borderColor="#1D4ED8"
  >
    <Box paddingX={1}>
      <Text color="#3B82F6" bold>
        #{' '}
      </Text>
      <Text color="#E5E7EB" bold>
        {content}
      </Text>
    </Box>
    <Box paddingX={1}>
      <Text color="#374151">{fmtTime(timestamp)}</Text>
    </Box>
  </Box>
)
