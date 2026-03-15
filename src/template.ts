import fs from 'fs'
import path from 'path'

export interface LoopContext {
  step: string
  prompt: string
  lastMessage: string
  iteration: number
  maxIterations: number
  logFile: string
}

export const DEFAULT_COOK_MD = `# COOK.md

## Project Instructions

## Agent Loop

Step: **\${step}** | Iteration: \${iteration}/\${maxIterations}

### Task
\${prompt}

\${lastMessage ? '### Previous Output\\n' + lastMessage : ''}

### History
Session log: \${logFile}
Read the session log for full context from previous steps.

### Gate Verdicts
- **DONE** — Work is complete, no High severity issues remain.
- **ITERATE** — High severity issues need to be fixed in the work just done.
- **NEXT** — Current step is good, but there is a next step or phase to continue with.
`

let cachedTemplateSrc: string | null = null
let cachedTemplateFn: Function | null = null

export function renderTemplate(cookMD: string, ctx: LoopContext): string {
  const escaped = cookMD
    .replace(/`/g, '\\`')
    .replace(/\$(?!\{)/g, '\\$')

  try {
    let fn: Function
    if (cachedTemplateSrc === escaped && cachedTemplateFn) {
      fn = cachedTemplateFn
    } else {
      fn = new Function(
        ...Object.keys(ctx),
        `return \`${escaped}\``
      )
      cachedTemplateSrc = escaped
      cachedTemplateFn = fn
    }
    return fn(...Object.values(ctx))
  } catch (err) {
    throw new Error(
      `Template error in COOK.md: ${err instanceof SyntaxError ? err.message : err}\n` +
      `Hint: Backticks and bare $ are escaped automatically.\n` +
      `For a literal \${...} in output, use \\\${...} in COOK.md.`
    )
  }
}

export function loadCookMD(projectRoot: string): string {
  try {
    return fs.readFileSync(path.join(projectRoot, 'COOK.md'), 'utf8')
  } catch {
    return DEFAULT_COOK_MD
  }
}
