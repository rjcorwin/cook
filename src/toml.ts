/**
 * Minimal TOML parser — extracts key-value pairs including table sections.
 * Returns a nested object where table sections become nested objects.
 *
 * Handles: double-quoted strings, single-quoted strings, bare values,
 * booleans (true/false), integers, inline comments, escape sequences,
 * and [table] sections.
 *
 * Does NOT handle: multiline strings, arrays, inline tables, dotted keys,
 * or array-of-tables ([[table]]). For full TOML compliance, use `smol-toml`.
 */
export function parseTOML(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  let currentSection: Record<string, unknown> = result

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue

    // Table header
    if (trimmed.startsWith('[') && !trimmed.startsWith('[[')) {
      const end = trimmed.indexOf(']')
      if (end > 0) {
        const sectionName = trimmed.slice(1, end).trim()
        if (!result[sectionName] || typeof result[sectionName] !== 'object') {
          result[sectionName] = {}
        }
        currentSection = result[sectionName] as Record<string, unknown>
        continue
      }
    }

    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 1) continue

    const key = trimmed.slice(0, eqIdx).trim()
    let rest = trimmed.slice(eqIdx + 1).trim()

    if (rest.startsWith('"')) {
      // Double-quoted string — handle escapes
      let value = ''
      let i = 1
      while (i < rest.length) {
        if (rest[i] === '\\' && i + 1 < rest.length) {
          const next = rest[i + 1]
          switch (next) {
            case '"': value += '"'; break
            case '\\': value += '\\'; break
            case 'n': value += '\n'; break
            case 't': value += '\t'; break
            case 'r': value += '\r'; break
            default: value += '\\' + next; break
          }
          i += 2
        } else if (rest[i] === '"') {
          break
        } else {
          value += rest[i]
          i++
        }
      }
      currentSection[key] = value
    } else if (rest.startsWith("'")) {
      // Single-quoted string — literal, no escapes
      const endQuote = rest.indexOf("'", 1)
      if (endQuote > 0) {
        currentSection[key] = rest.slice(1, endQuote)
      }
    } else {
      // Bare value — strip inline comment, then parse type
      const commentIdx = rest.indexOf('#')
      if (commentIdx >= 0) {
        rest = rest.slice(0, commentIdx)
      }
      const bare = rest.trim()
      if (!bare) continue

      if (bare === 'true') {
        currentSection[key] = true
      } else if (bare === 'false') {
        currentSection[key] = false
      } else if (/^-?\d+$/.test(bare)) {
        currentSection[key] = parseInt(bare, 10)
      } else if (/^-?\d+\.\d+$/.test(bare)) {
        currentSection[key] = parseFloat(bare)
      } else {
        currentSection[key] = bare
      }
    }
  }

  return result
}
