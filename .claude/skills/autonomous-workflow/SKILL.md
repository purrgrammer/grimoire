---
name: autonomous-workflow
description: Autonomous development workflow for designing, implementing, testing, reviewing, and shipping features end-to-end. Use when working through the /implement or /design commands, or when understanding the autonomous development process.
---

# Autonomous Development Workflow

## Purpose

This skill defines a fully autonomous development workflow for Grimoire. It enables an agent to take a feature request (from any source), research the codebase, design a solution, implement it, write tests, self-review, and create a PR — all without human intervention unless it hits an unrecoverable blocker.

## Philosophy

### Measure Twice, Cut Once

The most expensive part of autonomous development is implementing the wrong thing. The workflow front-loads understanding: read before writing, design before coding, test before shipping. Every phase has clear entry/exit criteria.

### Bounded Autonomy

The workflow runs fully autonomously but within guardrails:
- **Scope**: Stay focused on the requested feature. Fix small related issues, note larger ones.
- **Reversibility**: Prefer reversible actions. Never force-push, delete branches, or modify shared infrastructure without explicit permission.
- **Quality gates**: Each phase must pass before the next begins. No skipping verification.
- **Hard walls**: When truly stuck, stop gracefully — create a draft PR documenting what was done and what's blocking.

### Iteration Over Perfection

Tests failing? Fix and retry. Lint errors? Fix and retry. Build broken? Fix and retry. The workflow is designed to iterate until things work, not to get everything right on the first try. But it also detects loops — if the same error persists after 3 different fix attempts, that's a hard wall, not a fixable issue.

## Workflow Phases

### Phase 1: UNDERSTAND

**Goal**: Know exactly what to build and where it fits in the codebase.

**Input detection**:
| Input | Detection | Action |
|-------|-----------|--------|
| GitHub issue | `#123`, `123`, or `github.com/.../issues/` URL | `gh issue view <number>` |
| GitHub PR | `#123` with PR context, or `github.com/.../pull/` URL | `gh pr view <number>` |
| Spec file | File path ending in `.md` | Read the file |
| Natural language | Anything else | Use directly |

**Research checklist**:
- [ ] Read CLAUDE.md for architecture and conventions
- [ ] Search for related code (grep for keywords, types, function names)
- [ ] Find similar features already implemented (use as implementation templates)
- [ ] Identify all files that will need changes
- [ ] Check for existing tests in affected areas
- [ ] Understand the data flow (where do events come from? what state is involved?)

**Exit criteria**: Can articulate what the feature does, why it's needed, what files are affected, and what patterns to follow.

### Phase 2: DESIGN

**Goal**: Write a concrete plan before touching any implementation code.

**Output**: A spec file at `.claude/specs/<feature-slug>.md` with:
- Problem statement (what and why)
- Approach (how, at a high level)
- File-level change list (what files to create/modify and what each change does)
- Test plan (what behaviors to verify)
- Edge cases (and how each is handled)
- Patterns to follow (links to similar existing code)

**Why a file?** Audit trail, can be referenced in PR, can be re-used as input to `/implement` in future sessions, makes the design reviewable.

**Exit criteria**: Spec file written and the approach is clear enough to implement without further design decisions.

### Phase 3: IMPLEMENT

**Goal**: Write the code, following the spec.

**Principles**:
- Read before writing. Always read a file before modifying it.
- Follow existing patterns. Find similar code and match its style.
- Minimal changes. Don't refactor, add comments to, or "improve" code you didn't need to change.
- Write tests alongside implementation, not as an afterthought.

**Conventions** (from CLAUDE.md):
- Path alias: `@/` = `./src/`
- Applesauce helpers cache internally — no `useMemo` wrapping
- Singleton services (EventStore, RelayPool, RelayLiveness) — never create new instances
- Always check `canSign` before signing operations
- Use semantic Tailwind tokens (bg-background, text-foreground)
- Locale-aware formatting via `formatTimestamp()`
- State mutations through `src/core/logic.ts` pure functions
- Named exports (no default exports)
- Event renderers use human-friendly names (LiveActivityRenderer, not Kind30311Renderer)

### Phase 4: TEST

**Goal**: All tests pass, including new ones for the feature.

**Process**:
1. Run `npm run test:run`
2. If tests fail:
   - Read the error output carefully
   - Identify root cause (not just the symptom)
   - Fix and re-run
   - **Loop detection**: Track error signatures. If the same fundamental error persists after 3 different fix attempts, it's a hard wall.
3. Continue until all tests pass

**What to test**:
- Parsers: all argument combinations, edge cases, validation
- Pure functions: state mutations, business logic
- Utilities: helper functions, data transformations
- NOT React components (tested manually per project convention)

### Phase 5: SELF-REVIEW

**Goal**: Catch issues before a human reviewer sees them.

**Process**:
1. Run `git diff` to see all changes holistically
2. Review against the 8-point criteria from `/review`:
   1. Correctness & edge cases
   2. Nostr protocol compliance
   3. Applesauce patterns (singleton usage, no useMemo on helpers)
   4. React best practices (cleanup, stable refs, dependency arrays)
   5. Code quality & simplicity (no over-engineering)
   6. Codebase consistency (path alias, file org, Tailwind tokens)
   7. Testing & safety (XSS, injection, input validation)
   8. TypeScript (proper types, no unjustified `any`)
3. Fix any issues found
4. Related issues discovered during review:
   - Small/closely related → fix inline
   - Larger/unrelated → note for PR description

### Phase 6: VERIFY

**Goal**: The full CI gate passes locally.

**Process**:
1. `npm run lint` — fix any errors, re-run until clean
2. `npm run test:run` — must pass (if something broke during review fixes, fix it)
3. `npm run build` — must succeed

This is the final quality gate. Nothing ships until all three pass.

### Phase 7: SHIP

**Goal**: Clean commit, pushed branch, PR ready for human review.

**Process**:
1. Stage files selectively (never `git add -A` — avoid secrets, large binaries)
2. Write commit message following repo conventions (concise, explains "why")
3. Push to the feature branch
4. Create PR via `gh pr create`:
   - **Title**: Clear, concise, under 70 characters
   - **Body** (use HEREDOC for formatting):
     ```
     ## Summary
     - What this PR does (2-3 bullets)

     ## Changes
     - File-by-file summary of what changed

     ## Test Plan
     - How to verify the changes work
     - What tests were added

     ## Notes
     - Trade-offs made and rationale
     - Related issues discovered (if any)
     ```
5. After PR creation, monitor CI:
   - `gh pr checks <number> --watch` (timeout after 5 minutes)
   - If CI fails: investigate with `gh pr checks`, fix locally, push again
   - Iterate until CI passes or hit a hard wall

## Hard Wall Protocol

When you hit a truly unrecoverable blocker:

1. **Document thoroughly**: What was attempted, what failed, why it's stuck
2. **Commit what works**: Don't throw away good progress
3. **Create a draft PR**: `gh pr create --draft`
4. **Explain in PR body**: Add a `## Blockers` section with:
   - The specific error or issue
   - What approaches were tried
   - What information or decision is needed from a human
5. **Don't guess**: If you need credentials, API keys, design decisions, or architectural guidance — say so clearly

## Scope Management

| Discovered Issue | Action |
|-----------------|--------|
| Typo in file you're editing | Fix it |
| Broken import in file you're modifying | Fix it |
| Bug closely related to your feature | Fix it, mention in PR |
| Bug in unrelated area | Note in PR under "Related Issues Found" |
| Architectural concern | Note in PR, don't attempt to fix |
| Security vulnerability | Fix if in your files, flag prominently if elsewhere |

## Integration with GitHub

The workflow uses `gh` CLI for all GitHub interactions:

### Issue Integration
```bash
# Fetch issue details
gh issue view 123

# Close issue via PR (automatic when PR merges if body says "Closes #123")
# Include "Closes #123" or "Fixes #123" in PR body
```

### PR Workflow
```bash
# Create PR
gh pr create --title "..." --body "..."

# Create draft PR (for hard walls)
gh pr create --draft --title "..." --body "..."

# Check CI status
gh pr checks <number>

# Watch CI (blocks until complete or timeout)
gh pr checks <number> --watch

# View PR diff (useful for self-review)
gh pr diff <number>

# Add comment to PR
gh pr comment <number> --body "..."
```

### CI Feedback Loop
After pushing to a PR:
1. `gh pr checks <number> --watch` — wait for CI
2. If checks fail: `gh pr checks <number>` to see which jobs failed
3. Investigate the failure, fix locally
4. Push fix, repeat until green

## Using the Workflow

### Via Slash Commands

```bash
# Full autonomous implementation
/implement Add a badge showing event kind in the feed

# From a GitHub issue
/implement #42

# From a spec file
/implement .claude/specs/event-badges.md

# Design only (no implementation)
/design Add relay health indicators to the status bar
```

### Composing Standalone Phases

The workflow phases are also available as individual commands:
- `/design` — Research + write spec (Phase 1-2)
- `/implement` — Full lifecycle (Phase 1-7)
- `/test` — Run tests and report (Phase 4)
- `/review` — Code review against standards (Phase 5)
- `/verify` — Lint + test + build gate (Phase 6)
- `/commit-push-pr` — Ship changes (Phase 7)
- `/lint-fix` — Fix formatting and lint issues

You can run phases independently. For example:
1. `/design #42` — Create spec, discuss with user
2. (User approves or modifies spec)
3. `/implement .claude/specs/relay-health.md` — Implement from approved spec
