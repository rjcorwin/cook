import React from 'react'
import { Static, Box, Text } from 'ink'

export interface Section {
  step: string
  iteration: number
  prompt: string | null
  lines: string[]
}

const STEP_COLORS: Record<string, string> = {
  work: 'red',
  review: 'green',
  gate: 'blue',
}

function SectionBox({ section, showPrompt }: { section: Section; showPrompt: boolean }) {
  const color = STEP_COLORS[section.step] ?? 'white'
  const label = `${section.step} (iteration ${section.iteration})`

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={color} paddingX={1}>
      <Text bold color={color}>{label}</Text>
      {showPrompt && section.prompt && (
        <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1} marginY={1}>
          <Text bold color="yellow">prompt</Text>
          <Text>{section.prompt}</Text>
        </Box>
      )}
      {section.lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  )
}

interface LogStreamProps {
  completedSections: Section[]
  currentSection: Section | null
  showPrompt: boolean
}

export function LogStream({ completedSections, currentSection, showPrompt }: LogStreamProps) {
  return (
    <>
      <Static items={completedSections}>
        {(section, index) => (
          <Box key={index}>
            <SectionBox section={section} showPrompt={showPrompt} />
          </Box>
        )}
      </Static>
      {currentSection && currentSection.lines.length > 0 && (
        <SectionBox section={currentSection} showPrompt={showPrompt} />
      )}
    </>
  )
}
