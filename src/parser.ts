// src/parser.ts — Unified parser producing a recursive AST from CLI args

import type { SandboxMode } from './runner.js'

// --- AST Node Types ---

export type Resolver = 'pick' | 'merge' | 'compare'

export type Node =
  | { type: 'work'; prompt: string }
  | { type: 'repeat'; inner: Node; count: number }
  | { type: 'review'; inner: Node; reviewPrompt?: string; gatePrompt?: string; iteratePrompt?: string; maxIterations: number }
  | { type: 'ralph'; inner: Node; maxTasks: number; gatePrompt: string }
  | { type: 'composition'; branches: Node[]; resolver: Resolver; criteria?: string }

// --- Parsed flags ---

export interface ParsedFlags {
  work?: string
  review?: string
  gate?: string
  iterate?: string
  maxIterations?: number
  model?: string
  agent?: string
  sandbox?: SandboxMode
  workAgent?: string
  reviewAgent?: string
  gateAgent?: string
  iterateAgent?: string
  ralphAgent?: string
  workModel?: string
  reviewModel?: string
  gateModel?: string
  iterateModel?: string
  ralphModel?: string
  showRequest: boolean
  noWait: boolean
  yes: boolean
}

// --- Reserved keywords and patterns ---

const RESERVED_KEYWORDS = new Set(['review', 'ralph', 'race', 'repeat', 'vs', 'pick', 'merge', 'compare'])
const XN_PATTERN = /^x(\d+)$/i
const VN_PATTERN = /^v(\d+)$/i
const BARE_NUMBER = /^\d+$/

function isReserved(token: string): boolean {
  return RESERVED_KEYWORDS.has(token.toLowerCase()) || XN_PATTERN.test(token) || VN_PATTERN.test(token)
}

function isBareNumber(token: string): boolean {
  return BARE_NUMBER.test(token)
}

// --- Flag parsing ---

const VALUE_FLAGS = new Set([
  '--work', '--review', '--gate', '--iterate',
  '--model', '--agent', '--sandbox',
  '--work-agent', '--review-agent', '--gate-agent', '--iterate-agent', '--ralph-agent',
  '--work-model', '--review-model', '--gate-model', '--iterate-model', '--ralph-model',
  '--max-iterations',
])
const BOOLEAN_FLAGS = new Set(['--hide-request', '--no-wait', '--yes'])

export function separateFlags(args: string[]): { flags: Record<string, string>; positional: string[] } {
  const flags: Record<string, string> = {}
  const positional: string[] = []

  let i = 0
  while (i < args.length) {
    if (args[i] === '-y') {
      flags['--yes'] = 'true'
    } else if (args[i] === '-h') {
      flags['--help'] = 'true'
    } else if (args[i].startsWith('--')) {
      const flag = args[i]
      if (flag.includes('=')) {
        const [key, ...rest] = flag.split('=')
        flags[key] = rest.join('=')
      } else if (VALUE_FLAGS.has(flag)) {
        if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          flags[flag] = args[i + 1]
          i++
        }
      } else if (BOOLEAN_FLAGS.has(flag)) {
        flags[flag] = 'true'
      }
    } else {
      positional.push(args[i])
    }
    i++
  }

  return { flags, positional }
}

export function buildParsedFlags(flags: Record<string, string>): ParsedFlags {
  const sandboxFlag = flags['--sandbox']
  const sandbox = (sandboxFlag === 'agent' || sandboxFlag === 'docker') ? sandboxFlag : undefined

  return {
    work: flags['--work'],
    review: flags['--review'],
    gate: flags['--gate'],
    iterate: flags['--iterate'],
    maxIterations: flags['--max-iterations'] ? parseInt(flags['--max-iterations'], 10) : undefined,
    model: flags['--model'],
    agent: flags['--agent'],
    sandbox,
    workAgent: flags['--work-agent'],
    reviewAgent: flags['--review-agent'],
    gateAgent: flags['--gate-agent'],
    iterateAgent: flags['--iterate-agent'],
    ralphAgent: flags['--ralph-agent'],
    workModel: flags['--work-model'],
    reviewModel: flags['--review-model'],
    gateModel: flags['--gate-model'],
    iterateModel: flags['--iterate-model'],
    ralphModel: flags['--ralph-model'],
    showRequest: flags['--hide-request'] !== 'true',
    noWait: flags['--no-wait'] === 'true',
    yes: flags['--yes'] === 'true',
  }
}

// --- Pipeline parser ---

/**
 * Parse a sequence of positional tokens into an AST node.
 * Consumes tokens left-to-right, building the tree bottom-up.
 */
function parsePipeline(tokens: string[], parsedFlags: ParsedFlags): Node {
  if (tokens.length === 0) {
    throw new Error('Work prompt is required')
  }

  let i = 0

  // First token must be a non-keyword string (work prompt)
  if (isReserved(tokens[0]) || isBareNumber(tokens[0])) {
    throw new Error(`Work prompt is required (got reserved keyword "${tokens[0]}")`)
  }

  let current: Node = { type: 'work', prompt: parsedFlags.work ?? tokens[0] }
  i = 1

  // Scan for implicit review mode: bare strings/numbers after work that aren't keywords
  // fill review → gate → iterate → max-iterations slots
  if (i < tokens.length && !isReserved(tokens[i])) {
    // Could be positional prompts (implicit review) or a bare number
    const positionalPrompts: string[] = []
    let implicitMaxIterations: number | undefined

    while (i < tokens.length && !isReserved(tokens[i])) {
      if (isBareNumber(tokens[i])) {
        implicitMaxIterations = parseInt(tokens[i], 10)
        i++
        break // bare number terminates positional scan
      }
      positionalPrompts.push(tokens[i])
      i++
    }

    // If we collected any positional prompts, this is implicit review mode
    if (positionalPrompts.length > 0 || implicitMaxIterations !== undefined) {
      if (positionalPrompts.length > 0) {
        current = {
          type: 'review',
          inner: current,
          reviewPrompt: parsedFlags.review ?? positionalPrompts[0],
          gatePrompt: parsedFlags.gate ?? positionalPrompts[1],
          iteratePrompt: parsedFlags.iterate ?? positionalPrompts[2],
          maxIterations: implicitMaxIterations ?? parsedFlags.maxIterations ?? 3,
        }
      } else if (implicitMaxIterations !== undefined) {
        // Just a bare number after work — implicit review with default prompts
        current = {
          type: 'review',
          inner: current,
          reviewPrompt: parsedFlags.review,
          gatePrompt: parsedFlags.gate,
          iteratePrompt: parsedFlags.iterate,
          maxIterations: implicitMaxIterations,
        }
      }
    }
  }

  // Continue scanning for keywords
  while (i < tokens.length) {
    const token = tokens[i]
    const lower = token.toLowerCase()

    // xN / repeat N
    const xMatch = token.match(XN_PATTERN)
    if (xMatch) {
      const count = parseInt(xMatch[1], 10)
      if (count > 1) {
        current = { type: 'repeat', inner: current, count }
      }
      i++
      continue
    }
    if (lower === 'repeat') {
      i++
      if (i >= tokens.length || !isBareNumber(tokens[i])) {
        throw new Error('repeat requires a number (e.g., repeat 3)')
      }
      const count = parseInt(tokens[i], 10)
      if (count > 1) {
        current = { type: 'repeat', inner: current, count }
      }
      i++
      continue
    }

    // review keyword
    if (lower === 'review') {
      i++
      let reviewPrompt: string | undefined = parsedFlags.review
      let gatePrompt: string | undefined = parsedFlags.gate
      let iteratePrompt: string | undefined = parsedFlags.iterate
      let maxIterations: number = parsedFlags.maxIterations ?? 3

      // Consume optional review/gate/iterate prompts and max-iterations
      const prompts: string[] = []
      while (i < tokens.length && !isReserved(tokens[i])) {
        if (isBareNumber(tokens[i])) {
          maxIterations = parseInt(tokens[i], 10)
          i++
          break
        }
        prompts.push(tokens[i])
        i++
      }

      if (prompts.length >= 1) reviewPrompt = reviewPrompt ?? prompts[0]
      if (prompts.length >= 2) gatePrompt = gatePrompt ?? prompts[1]
      if (prompts.length >= 3) iteratePrompt = iteratePrompt ?? prompts[2]

      current = {
        type: 'review',
        inner: current,
        reviewPrompt,
        gatePrompt,
        iteratePrompt,
        maxIterations,
      }
      continue
    }

    // ralph keyword
    if (lower === 'ralph') {
      i++
      let maxTasks = 100

      // Optional N (default 100)
      if (i < tokens.length && isBareNumber(tokens[i])) {
        maxTasks = parseInt(tokens[i], 10)
        i++
      }

      // Required gate prompt string
      if (i >= tokens.length || isReserved(tokens[i]) || isBareNumber(tokens[i])) {
        throw new Error('ralph requires a gate prompt string')
      }
      const gatePrompt = tokens[i]
      i++

      current = { type: 'ralph', inner: current, maxTasks, gatePrompt }
      continue
    }

    // vN / race N — composition with identical copies
    const vMatch = token.match(VN_PATTERN)
    if (vMatch || lower === 'race') {
      let count: number
      if (vMatch) {
        count = parseInt(vMatch[1], 10)
        i++
      } else {
        // race N
        i++
        if (i >= tokens.length || !isBareNumber(tokens[i])) {
          throw new Error('race requires a number (e.g., race 3)')
        }
        count = parseInt(tokens[i], 10)
        i++
      }

      if (count <= 1) {
        // v1 or race 1 is a no-op
        continue
      }

      // Create N identical branches (clones of current)
      const branches: Node[] = Array.from({ length: count }, () => structuredClone(current))

      // Scan for resolver + criteria
      let resolver: Resolver = 'pick'
      let criteria: string | undefined

      if (i < tokens.length) {
        const resolverToken = tokens[i].toLowerCase()
        if (resolverToken === 'pick' || resolverToken === 'merge' || resolverToken === 'compare') {
          resolver = resolverToken
          i++
          // Consume optional criteria string
          if (resolver !== 'compare' && i < tokens.length && !isReserved(tokens[i]) && !isBareNumber(tokens[i])) {
            criteria = tokens[i]
            i++
          }
        } else if (!isReserved(tokens[i]) && !isBareNumber(tokens[i])) {
          // Bare string after vN without keyword — implicit pick with criteria
          resolver = 'pick'
          criteria = tokens[i]
          i++
        }
      }

      current = { type: 'composition', branches, resolver, criteria }

      // Check for second-level composition (compare cannot be followed by one)
      if (resolver !== 'compare' && i < tokens.length) {
        const nextMatch = tokens[i].match(VN_PATTERN)
        if (nextMatch || tokens[i].toLowerCase() === 'race') {
          // Second-level composition — recurse
          let count2: number
          if (nextMatch) {
            count2 = parseInt(nextMatch[1], 10)
            i++
          } else {
            i++
            if (i >= tokens.length || !isBareNumber(tokens[i])) {
              throw new Error('race requires a number (e.g., race 3)')
            }
            count2 = parseInt(tokens[i], 10)
            i++
          }

          if (count2 > 1) {
            const secondBranches: Node[] = Array.from({ length: count2 }, () => structuredClone(current))
            let resolver2: Resolver = 'pick'
            let criteria2: string | undefined

            if (i < tokens.length) {
              const resolverToken2 = tokens[i].toLowerCase()
              if (resolverToken2 === 'pick' || resolverToken2 === 'merge' || resolverToken2 === 'compare') {
                resolver2 = resolverToken2
                i++
                if (resolver2 !== 'compare' && i < tokens.length && !isReserved(tokens[i]) && !isBareNumber(tokens[i])) {
                  criteria2 = tokens[i]
                  i++
                }
              } else if (!isReserved(tokens[i]) && !isBareNumber(tokens[i])) {
                // Bare string after second-level vN — implicit pick with criteria
                resolver2 = 'pick'
                criteria2 = tokens[i]
                i++
              }
            }

            current = { type: 'composition', branches: secondBranches, resolver: resolver2, criteria: criteria2 }
          }
        }
      }
      continue
    }

    // pick / merge / compare without preceding vN — shouldn't reach here in valid input
    if (lower === 'pick' || lower === 'merge' || lower === 'compare') {
      // Treat as resolver for last composition if applicable
      i++
      continue
    }

    // Unknown token — error
    throw new Error(`Unknown token "${token}". Expected a keyword (review, ralph, repeat, race, vs, pick, merge, compare) or a pattern like x3, v3.`)
  }

  return current
}

// --- Main parse function ---

export function parse(args: string[]): { ast: Node; flags: ParsedFlags } {
  const { flags, positional } = separateFlags(args)
  const parsedFlags = buildParsedFlags(flags)

  if (positional.length === 0) {
    if (parsedFlags.work) {
      let ast: Node = { type: 'work', prompt: parsedFlags.work }
      if (parsedFlags.review || parsedFlags.gate) {
        ast = {
          type: 'review',
          inner: ast,
          reviewPrompt: parsedFlags.review,
          gatePrompt: parsedFlags.gate,
          iteratePrompt: parsedFlags.iterate,
          maxIterations: parsedFlags.maxIterations ?? 3,
        }
      }
      return { ast, flags: parsedFlags }
    }
    throw new Error('Work prompt is required')
  }

  // Check for vs in positional tokens
  const hasVs = positional.some(t => t.toLowerCase() === 'vs')

  if (hasVs) {
    // Split into branch segments and trailing resolver tokens
    const segments: string[][] = []
    let current: string[] = []
    const resolverTokens: string[] = []
    let pastLastBranch = false

    for (let i = 0; i < positional.length; i++) {
      const token = positional[i]
      const lower = token.toLowerCase()

      if (lower === 'vs' && !pastLastBranch) {
        if (current.length === 0) {
          throw new Error('Empty branch before "vs"')
        }
        segments.push(current)
        current = []
        continue
      }

      if (!pastLastBranch) {
        // Check if this token starts the resolver section
        // A resolver keyword that appears after we've seen at least one branch segment
        if (segments.length > 0 && (lower === 'pick' || lower === 'merge' || lower === 'compare')) {
          // Push the current branch
          if (current.length > 0) {
            segments.push(current)
            current = []
          }
          pastLastBranch = true
          resolverTokens.push(token)
          continue
        }
        current.push(token)
      } else {
        resolverTokens.push(token)
      }
    }

    // Push final branch segment
    if (!pastLastBranch && current.length > 0) {
      segments.push(current)
    }

    if (segments.length < 2) {
      throw new Error('vs requires at least 2 branches')
    }

    // Parse each branch segment independently
    const branches: Node[] = segments.map(seg => parsePipeline(seg, parsedFlags))

    // Parse resolver from trailing tokens
    let resolver: Resolver = 'pick'
    let criteria: string | undefined
    let rTokenIdx = 0

    if (resolverTokens.length > 0) {
      const resolverName = resolverTokens[0].toLowerCase()
      if (resolverName === 'pick' || resolverName === 'merge' || resolverName === 'compare') {
        resolver = resolverName
        rTokenIdx = 1
        // Consume criteria
        if (resolver !== 'compare' && rTokenIdx < resolverTokens.length && !isReserved(resolverTokens[rTokenIdx]) && !isBareNumber(resolverTokens[rTokenIdx])) {
          criteria = resolverTokens[rTokenIdx]
          rTokenIdx++
        }
      }
    }

    let ast: Node = { type: 'composition', branches, resolver, criteria }

    // Check for second-level composition (compare cannot be followed by one)
    if (resolver !== 'compare' && rTokenIdx < resolverTokens.length) {
      const nextToken = resolverTokens[rTokenIdx]
      const vMatch2 = nextToken.match(VN_PATTERN)
      if (vMatch2 || nextToken.toLowerCase() === 'race') {
        let count2: number
        if (vMatch2) {
          count2 = parseInt(vMatch2[1], 10)
          rTokenIdx++
        } else {
          rTokenIdx++
          if (rTokenIdx >= resolverTokens.length || !isBareNumber(resolverTokens[rTokenIdx])) {
            throw new Error('race requires a number')
          }
          count2 = parseInt(resolverTokens[rTokenIdx], 10)
          rTokenIdx++
        }

        if (count2 > 1) {
          const secondBranches: Node[] = Array.from({ length: count2 }, () => structuredClone(ast))
          let resolver2: Resolver = 'pick'
          let criteria2: string | undefined

          if (rTokenIdx < resolverTokens.length) {
            const r2 = resolverTokens[rTokenIdx].toLowerCase()
            if (r2 === 'pick' || r2 === 'merge' || r2 === 'compare') {
              resolver2 = r2
              rTokenIdx++
              if (resolver2 !== 'compare' && rTokenIdx < resolverTokens.length) {
                criteria2 = resolverTokens[rTokenIdx]
                rTokenIdx++
              }
            }
          }

          ast = { type: 'composition', branches: secondBranches, resolver: resolver2, criteria: criteria2 }
        }
      }
    }

    return { ast, flags: parsedFlags }
  }

  // No vs — single pipeline
  const ast = parsePipeline(positional, parsedFlags)
  return { ast, flags: parsedFlags }
}
