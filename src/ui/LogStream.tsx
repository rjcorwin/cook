import React from 'react'
import { Static, Box, Text } from 'ink'

export interface Section {
  step: string
  iteration: number
  lines: string[]
}

const STEP_COLORS: Record<string, string> = {
  work: 'red',
  review: 'green',
  gate: 'blue',
}

function SectionBox({ section }: { section: Section }) {
  const color = STEP_COLORS[section.step] ?? 'white'
  const label = `${section.step} (iteration ${section.iteration})`

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={color} paddingX={1}>
      <Text bold color={color}>{label}</Text>
      {section.lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  )
}

interface LogStreamProps {
  completedSections: Section[]
  currentSection: Section | null
}

export function LogStream({ completedSections, currentSection }: LogStreamProps) {
  return (
    <>
      <Static items={completedSections}>
        {(section, index) => (
          <Box key={index}>
            <SectionBox section={section} />
          </Box>
        )}
      </Static>
      {currentSection && currentSection.lines.length > 0 && (
        <SectionBox section={currentSection} />
      )}
    </>
  )
}
