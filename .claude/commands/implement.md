Fully autonomous implementation workflow. Take the input through design, implementation, testing, review, verification, and PR creation.

Input: $ARGUMENTS

Git status: ${{ git status --short }}
Current branch: ${{ git branch --show-current }}
Recent commits: ${{ git log --oneline -5 }}

Read the skill doc at `.claude/skills/autonomous-workflow/SKILL.md` for the full workflow reference.

---

## Phase 1: UNDERSTAND

Detect input type and gather context:
- **GitHub issue** (`#123`, `123`, or URL): Run `gh issue view <number>` to get title, body, labels, comments
- **Spec file** (`.md` path): Read the spec — skip to Phase 3 (IMPLEMENT)
- **Natural language**: Use the description directly

Research the codebase:
1. Read `CLAUDE.md` for architecture and conventions
2. Search for related code — grep/glob for relevant files, types, hooks, components
3. Find similar existing features to use as implementation templates
4. Identify all files that will need changes and existing tests in affected areas
5. Understand the data flow for the feature

If the input lacks sufficient detail to implement confidently, ask clarifying questions before proceeding. Otherwise, continue autonomously.

## Phase 2: DESIGN

Write a technical spec to `.claude/specs/<feature-slug>.md`:

```markdown
# Feature: <title>

## Problem
What problem does this solve? Why is it needed?

## Approach
High-level strategy. How does it fit into the existing architecture?

## Changes
- `path/to/file.ts` - What changes and why
- `path/to/new-file.ts` (new) - What this file does
- `path/to/file.test.ts` (new/modify) - What tests to add

## Test Plan
- Key behaviors to verify
- Edge cases to cover

## Edge Cases
- Each edge case and how it's handled

## Patterns to Follow
- Reference existing similar code in the codebase
```

## Phase 3: IMPLEMENT

Follow the spec. For each file:
1. Read the existing file first (if modifying)
2. Find a similar file in the codebase and match its patterns
3. Make changes following CLAUDE.md conventions
4. Write tests alongside implementation

Key conventions:
- `@/` path alias for imports
- Named exports only (no default exports)
- Applesauce helpers cache internally — never wrap in useMemo
- Singleton services — never create new EventStore/RelayPool/RelayLiveness
- Check `canSign` before signing operations
- Semantic Tailwind tokens (bg-background, text-foreground)
- Locale-aware formatting via `formatTimestamp()`
- State mutations through `src/core/logic.ts`
- Human-friendly renderer names (LiveActivityRenderer, not Kind30311Renderer)

## Phase 4: TEST

1. Run `npm run test:run`
2. If tests fail:
   - Read error output carefully — identify root cause, not symptom
   - Fix the issue
   - Re-run tests
   - **Loop detection**: If the same error persists after 3 different fix attempts, flag as hard wall
3. Iterate until all tests pass

## Phase 5: SELF-REVIEW

1. Run `git diff` to see all changes holistically
2. Review against project standards:
   - Correctness: edge cases, race conditions, error handling?
   - Nostr compliance: correct event kinds, tag structures, NIP adherence?
   - Applesauce patterns: no useMemo on helpers, singleton usage, RxJS cleanup?
   - React: useEffect cleanup, stable refs, dependency arrays, canSign checks?
   - Simplicity: is this the minimal solution? No over-engineering?
   - Consistency: path alias, file organization, Tailwind tokens, formatTimestamp?
   - Safety: XSS, injection, input validation at boundaries?
   - TypeScript: proper types, no unjustified `any`?
3. Fix any issues found during review
4. Small related bugs discovered: fix them. Larger unrelated issues: note for PR.

## Phase 6: VERIFY

Run full verification — all three must pass:
1. `npm run lint` — fix errors if any, re-run until clean
2. `npm run test:run` — must pass
3. `npm run build` — must succeed

If anything fails, fix and retry. This is the final gate before shipping.

## Phase 7: SHIP

1. Stage relevant files selectively (never `git add -A`)
2. Write a clear commit message (concise, explains "why")
3. Push to the current branch (create branch from main if currently on main/master)
4. Create PR via `gh pr create`:
   - Title: clear, under 70 chars
   - Body with: Summary, Changes, Test Plan, Notes sections
   - Include `Closes #<issue>` if implementing a GitHub issue
   - Use HEREDOC for body formatting
5. After PR creation:
   - Run `gh pr checks <number> --watch` (timeout 5 min) to monitor CI
   - If CI fails: investigate with `gh pr checks`, fix locally, push, repeat
   - Iterate until CI passes or hit hard wall

## Hard Wall Protocol

If you hit an unrecoverable blocker:
1. Commit what works — don't throw away progress
2. Create a **draft** PR: `gh pr create --draft`
3. Add a `## Blockers` section to the PR body explaining:
   - What was attempted
   - What failed and why
   - What information or decision is needed from a human
4. Be specific about what's needed to unblock

## Scope Management

- Typos/broken imports in files you're editing → fix them
- Bugs closely related to your feature → fix, mention in PR
- Bugs in unrelated areas → note in PR under "Related Issues Found"
- Architectural concerns → note in PR, don't attempt to fix
