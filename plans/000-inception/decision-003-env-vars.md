# Decision: Environment Variables Passed to Sandbox

**Status:** Accepted
**Date:** 2026-02-27
**Deciders:** rjcorwin

## Context

The sandbox container needs certain environment variables to function — at minimum the Anthropic API key for Claude and git identity for commits. But a sandbox that forwards the host's entire environment defeats the purpose of isolation. We need a policy for what gets passed in and how users can extend it.

## Options

### Option 1: Hardcoded list only

arpi always passes a fixed set of env vars into the container:
- `ANTHROPIC_API_KEY`
- `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` (derived from host's `git config`)
- `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`

Nothing else, ever.

**Pros:**
- Simplest to implement and reason about
- Minimal attack surface — you know exactly what's in the container

**Cons:**
- No escape hatch for projects that need more (private registries, custom tooling)
- Users who need extra vars would have to fork arpi or hack around it

### Option 2: Hardcoded defaults + configurable extras

Same hardcoded list as Option 1, but `.arpi.config.json` can declare additional env vars to pass through.

```json
{
  "env": [
    "NPM_TOKEN",
    "PYPI_TOKEN"
  ]
}
```

arpi reads the named vars from the host environment and forwards them. Values are never stored in the config file — only variable names.

**Pros:**
- Works out of the box for the common case (API key + git identity)
- Projects that need more can opt in explicitly
- Config is committable — team members get the same env var forwarding
- Only names in config, not values — no secrets in version control

**Cons:**
- Developers must know which env vars their tools need
- Each additional var is a conscious expansion of the sandbox boundary

### Option 3: Explicit-only

arpi passes nothing by default. Every env var, including `ANTHROPIC_API_KEY`, must be declared in `.arpi.config.json`.

**Pros:**
- Maximum explicitness — nothing implicit

**Cons:**
- Broken out of the box — first run fails without config
- Forces every user through `arpi init` before seeing any value
- Contradicts the zero-setup-by-default principle from decision-002

### Option 4: Pass-through everything

Forward the host's entire environment into the container.

**Pros:**
- Nothing to configure

**Cons:**
- Defeats the purpose of sandboxing — AWS credentials, SSH agent socket, PATH with host binaries, etc. all leak in
- Not a real option for a security-focused tool

## Decision

**Option 2: Hardcoded defaults + configurable extras.**

The hardcoded set covers what every arpi run needs:
- `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` — derived from host `git config user.name` / `user.email` so commits have correct attribution

Note: `ANTHROPIC_API_KEY` was originally in this list but is no longer required. Per decision-004, auth is handled by mounting `~/.claude/` read-only. If a user happens to have `ANTHROPIC_API_KEY` set, it can be added to the `"env"` array in `.arpi.config.json`, and Claude CLI will pick it up.

Additional env vars are declared by name in `.arpi.config.json` under an `"env"` array. arpi reads their values from the host environment at runtime. This keeps secrets out of config files while letting teams document which vars the sandbox needs.

## Consequences

### Positive
- Zero-config default works immediately (git identity is all the common case needs; auth handled separately via decision-004)
- Teams can commit `.arpi.config.json` with env var names so everyone forwards the same set
- Each additional var is an explicit, auditable decision to widen the sandbox boundary

### Negative
- Developers adding vars to config need to know the exact env var names their tools expect
- Forgetting to add a needed var produces an error inside the container that may not be obvious (e.g., `npm install` fails with auth error)

### Neutral
- Git identity vars are derived, not forwarded — arpi reads `git config` on the host and sets the env vars, so they work even if the developer doesn't have them as env vars on the host
