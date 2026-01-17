Run full verification suite for the current changes.

Execute these checks in sequence, stopping on first failure:

1. **Lint Check**: `npm run lint`
2. **Test Suite**: `npm run test:run`
3. **Build Check**: `npm run build`

For each step:
- If it passes, proceed to the next
- If it fails, report the specific errors and suggest fixes

After all checks pass, summarize:
- Total tests run and passed
- Any warnings to be aware of
- Confirmation that the changes are ready for PR
