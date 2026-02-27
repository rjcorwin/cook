# Decision: Container Authentication

**Status:** Accepted
**Date:** 2026-02-27
**Deciders:** rjcorwin

## Context

The research assumed authentication via `ANTHROPIC_API_KEY` environment variable. But arpi's primary audience — developers who already use the `claude` CLI daily — are likely on Pro/Team/Enterprise subscriptions authenticating via OAuth. Their credentials are stored in `~/.claude/` on the host. They don't have an `ANTHROPIC_API_KEY` env var and shouldn't need one.

This means the container needs access to the host's Claude auth state, not just an API key.

## Options

### Option 1: Mount `~/.claude/` read-only

Bind-mount the host's `~/.claude/` directory into the container at the same path, read-only. The Claude CLI inside the container picks up the existing OAuth credentials.

**Pros:**
- Works immediately for subscription users — no extra setup
- Works for API key users too (claude CLI stores config there regardless)
- Simple to implement: one `-v` flag on the docker run
- Read-only mount prevents the container from modifying auth state

**Cons:**
- Exposes all of `~/.claude/` to the container — config, session history, preferences, not just auth
- Widens the sandbox boundary beyond the project directory
- If `~/.claude/` contains sensitive non-auth data in the future, it leaks in

### Option 2: Mount only the auth credential file

Identify the specific file(s) Claude CLI needs for OAuth tokens and mount only those.

**Pros:**
- Minimal exposure — only auth, nothing else
- Tighter sandbox boundary

**Cons:**
- Requires knowing the internal structure of `~/.claude/` which could change between CLI versions
- Brittle — a Claude CLI update that moves the auth file breaks arpi
- More investigation needed to identify the right file(s)

### Option 3: Require API key

Require `ANTHROPIC_API_KEY` for arpi usage regardless of how the developer authenticates `claude` on the host.

**Pros:**
- Clean separation — no host files mounted for auth
- Simple env var forwarding

**Cons:**
- Subscription users don't have an API key by default
- API usage is billed separately from the subscription — developers pay twice
- Adds friction for the exact audience arpi targets
- Contradicts the zero-setup-by-default principle

### Option 4: Auto-detect and support both

If `ANTHROPIC_API_KEY` is set, pass it as an env var. If not, mount `~/.claude/` read-only.

**Pros:**
- Works for both auth methods
- API key users don't expose `~/.claude/`

**Cons:**
- Two code paths to maintain and test
- Adds complexity for a v1

## Decision

**Option 1: Mount `~/.claude/` read-only.**

The primary audience authenticates via subscription/OAuth. Making them set up an API key is a non-starter — it's friction, cost, and contradicts zero-setup. Mounting `~/.claude/` read-only is one line of Docker config and it just works.

The exposure concern is real but bounded: the mount is read-only, the container is still filesystem-isolated and network-defaulted (or restricted), and `~/.claude/` primarily contains auth tokens and CLI preferences — not secrets on the level of SSH keys or cloud credentials. This is an acceptable tradeoff for v1. Option 2 (surgical mount) is a natural hardening step for later once we know which files are strictly needed.

This also supersedes the `ANTHROPIC_API_KEY` assumption in decision-003. The hardcoded env var list becomes git identity only. If a user happens to have `ANTHROPIC_API_KEY` set, it still gets picked up by the Claude CLI inside the container through the normal env var forwarding, but it's not required.

## Consequences

### Positive
- Subscription users work out of the box — no API key needed
- API key users also work (Claude CLI checks env var before stored credentials)
- One docker flag, minimal implementation complexity

### Negative
- `~/.claude/` contents (config, preferences, session data) are visible inside the container
- If Claude CLI stores sensitive data in `~/.claude/` in the future, it leaks into the sandbox
- Tighter mount (Option 2) would be more principled but needs CLI internals research

### Neutral
- Decision-003's hardcoded env list drops `ANTHROPIC_API_KEY` as a requirement — it becomes optional, with `~/.claude/` mount as the primary auth path
- `arpi init` / `.arpi.config.json` doesn't need auth-related config — auth is handled automatically
