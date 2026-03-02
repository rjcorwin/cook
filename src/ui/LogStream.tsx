import React, { useState, useEffect } from 'react'
import { Static, Box, Text } from 'ink'

export interface Section {
  step: string
  iteration: number
  request: string | null
  lines: string[]
}

const STEP_COLORS: Record<string, string> = {
  work: 'red',
  review: 'green',
  gate: 'blue',
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function Spinner() {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % SPINNER_FRAMES.length)
    }, 80)
    return () => clearInterval(timer)
  }, [])
  return <Text bold color="magenta">{SPINNER_FRAMES[frame]} response</Text>
}

function SectionBox({ section, showRequest, active }: { section: Section; showRequest: boolean; active: boolean }) {
  const color = STEP_COLORS[section.step] ?? 'white'
  const label = `${section.step} (iteration ${section.iteration})`

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={color} paddingX={1}>
      <Text bold color={color}>{label}</Text>
      {showRequest && section.request && (
        <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1} marginTop={1}>
          <Text bold color="yellow">request</Text>
          <Text>{section.request}</Text>
        </Box>
      )}
      <Box flexDirection="column" borderStyle="single" borderColor="magenta" paddingX={1} marginTop={1}>
        {active ? <Spinner /> : <Text bold color="magenta">response</Text>}
        {section.lines.map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
      </Box>
    </Box>
  )
}

interface LogStreamProps {
  completedSections: Section[]
  currentSection: Section | null
  showRequest: boolean
}

export function LogStream({ completedSections, currentSection, showRequest }: LogStreamProps) {
  return (
    <>
      <Static items={completedSections}>
        {(section, index) => (
          <Box key={index}>
            <SectionBox section={section} showRequest={showRequest} active={false} />
          </Box>
        )}
      </Static>
      {currentSection && (
        <SectionBox section={currentSection} showRequest={showRequest} active={true} />
      )}
    </>
  )
}
