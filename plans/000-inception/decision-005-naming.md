# Decision: Project Name

**Status:** Proposed
**Date:** 2026-02-27
**Deciders:** rjcorwin

## Context

The project needs a name that works as a CLI command, a conversation reference, and an identity. It's currently called `arpi` (a phonetic spelling of RPI — Research, Plan, Implement). The name should be short (easy to type repeatedly), memorable, and ideally evoke what the tool does: an AI that follows a structured recipe to cook up code changes.

Constraints:
- Must work as a CLI command (short, no conflicts with common Unix tools)
- Should be easy to say out loud ("run cook" vs "run arpi")
- Ideally available as a GitHub repo name and npm/brew package name
- Will appear in docs, config files (`.arpi.config.json` → `.cook.config.json`?), and conversation

## Options

### Option 1: `arpi`

The current name. Phonetic spelling of RPI (Research, Plan, Implement).

**Pros:**
- Already in use — no migration
- Directly encodes the methodology
- Unique — no namespace conflicts, easy to search for
- Three-letter domain of `.md` files (`ARPI.md`) looks intentional

**Cons:**
- Not immediately meaningful to newcomers — requires explanation
- Sounds like a proper noun, not a verb ("arpi yolo" doesn't flow naturally)
- Could be confused with "RPI" (Raspberry Pi) in search results
- Acronym-derived names feel corporate/dry

### Option 2: `cook`

Metaphor: the AI follows a recipe (the plan) to cook up code changes. The RPI workflow is the recipe structure.

**Pros:**
- Verb — reads naturally as a command: `cook yolo "Add dark mode"`
- Evocative metaphor: recipes → plans, ingredients → research, plating → PR
- Short (4 chars), easy to type, easy to say
- `cook init`, `cook research`, `cook plan`, `cook implement` all read well
- Memorable and fun

**Cons:**
- `cook` may conflict with existing CLI tools (e.g., Ruby's `cook` gem, though uncommon)
- Generic word — harder to search for ("cook CLI" returns kitchen results)
- The cooking metaphor might feel forced if pushed too far
- Config file `.cook.config.json` looks a bit odd

### Option 3: `cooker`

Agent noun form — "the thing that cooks." The tool is the cooker, the plan is the recipe.

**Pros:**
- More specific than `cook` — easier to search for
- Still carries the cooking metaphor
- `cooker yolo "Add dark mode"` reads reasonably well
- Less likely to conflict with existing tools

**Cons:**
- 6 characters — longer to type repeatedly
- "Cooker" as a standalone word sounds a bit awkward
- `cooker init` is fine but `cooker research` feels clunky
- Slang connotations in some regions (pressure cooker, etc.)

### Option 4: `rpi`

The literal acronym. Research, Plan, Implement.

**Pros:**
- Maximum clarity about methodology
- 3 characters — very short
- Direct, no metaphor to explain

**Cons:**
- Strongly associated with Raspberry Pi — search results will be polluted
- Acronyms are forgettable and hard to say in conversation ("run R-P-I")
- `rpi yolo` looks like a hardware command
- `.rpi.config.json` looks like Raspberry Pi config

## Decision

**Option 2: `cook`**

Tagline: **"Let it cook."**

The verb form reads naturally across all commands (`cook yolo`, `cook plan`, `cook init`), the cooking metaphor maps cleanly to the workflow without needing explanation, and "Let it cook" captures the hands-off philosophy — you set it up, walk away, let it cook. The searchability tradeoff is manageable ("cook cli" or "cook-dev" disambiguates).

## Consequences

### Positive
- Natural command syntax — `cook yolo "Add dark mode"` reads like English
- Memorable tagline that's already a well-known phrase
- Short (4 chars), easy to type, easy to say in conversation
- The metaphor extends naturally: recipes (plans), ingredients (research), plating (PR)

### Negative
- Generic word — SEO/searchability requires qualifiers ("cook cli", "cook dev tool")
- Potential namespace conflicts with obscure existing tools (mitigated by the specific domain)

### Neutral
- Renaming involves updating: the script filename (`arpi` → `cook`), config file names (`.arpi.config.json` → `.cook.config.json`), the per-repo instructions file (`ARPI.md` → `COOK.md`), Docker image names (`arpi-sandbox` → `cook-sandbox`), container names (`arpi-$$` → `cook-$$`), docs, and the repo itself
