Research the codebase and create a technical design spec for a feature. Does NOT implement — just designs.

Input: $ARGUMENTS

Read the skill doc at `.claude/skills/autonomous-workflow/SKILL.md` for the full workflow reference.

---

## Gather Context

Detect input type:
- **GitHub issue** (`#123`, `123`, or URL): Run `gh issue view <number>` for title, body, labels, comments
- **Natural language**: Use the description directly

Research the codebase thoroughly:
1. Read `CLAUDE.md` for architecture and conventions
2. Search for related code — grep/glob for relevant types, hooks, components, services
3. Find similar features already implemented (use as design templates)
4. Identify all files that would need changes
5. Check existing tests in affected areas
6. Understand the data flow (events, state, relay interactions)
7. Read relevant skill docs if the feature touches Nostr protocol, applesauce, or React patterns

If the input is unclear or ambiguous, ask clarifying questions before writing the spec.

## Write Spec

Create `.claude/specs/<feature-slug>.md`:

```markdown
# Feature: <title>

## Problem
What problem does this solve? Why is it needed?
(If from a GitHub issue, reference the issue and summarize)

## Approach
High-level strategy and rationale. How does this fit into the existing architecture?
Why this approach over alternatives?

## Changes
- `path/to/file.ts` - What changes and why
- `path/to/new-file.ts` (new) - What this new file does and why it's needed
- `path/to/file.test.ts` (new/modify) - What tests to add

## Test Plan
- Key behaviors to verify with automated tests
- Edge cases that need test coverage
- Manual verification steps (if UI changes)

## Edge Cases
- Each edge case identified and how it should be handled

## Open Questions
- Design decisions that could go either way (with your recommendation)
- Things that need human input or clarification
- Trade-offs worth discussing

## Patterns to Follow
- Reference specific files with similar patterns in the codebase
- Note which conventions from CLAUDE.md are most relevant
```

## Present

After writing the spec:
1. Summarize the key design decisions and rationale
2. Highlight any open questions or trade-offs
3. Note which existing patterns you're following and why
4. If there are alternative approaches, briefly explain why you chose this one

The spec can later be passed to `/implement` for autonomous implementation:
```
/implement .claude/specs/<feature-slug>.md
```
