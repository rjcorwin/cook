const VERDICT_PREFIX_RE = /^(?:(?:FINAL\s+)?(?:GATE|RALPH)\s+VERDICT|VERDICT|DECISION)\s*[:\-]\s*/
const VERDICT_TOKEN_RE = /^(DONE|ITERATE|NEXT)\b/

function normalizeVerdictLine(line: string): string {
  return line
    .trim()
    .replace(/^[>\-+*#\d.\)\s]+/, '')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase()
}

function parseVerdictToken(output: string, allowed: readonly string[]): string | null {
  for (const rawLine of output.split(/\r?\n/)) {
    let line = normalizeVerdictLine(rawLine)
    if (!line) continue

    line = line.replace(VERDICT_PREFIX_RE, '')

    const match = line.match(VERDICT_TOKEN_RE)
    if (match && allowed.includes(match[1])) {
      return match[1]
    }
  }
  return null
}

export function parseGateVerdict(output: string): 'DONE' | 'ITERATE' | null {
  const verdict = parseVerdictToken(output, ['DONE', 'ITERATE'])
  return verdict === 'DONE' || verdict === 'ITERATE' ? verdict : null
}

export function parseRalphVerdict(output: string): 'NEXT' | 'DONE' | null {
  const verdict = parseVerdictToken(output, ['NEXT', 'DONE'])
  return verdict === 'NEXT' || verdict === 'DONE' ? verdict : null
}
