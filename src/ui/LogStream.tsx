import React from 'react'
import { Static, Text } from 'ink'

interface LogStreamProps {
  lines: string[]
}

export function LogStream({ lines }: LogStreamProps) {
  return (
    <Static items={lines}>
      {(line, index) => <Text key={index}>{line}</Text>}
    </Static>
  )
}
