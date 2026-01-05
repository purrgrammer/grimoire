Run the test suite and report results.

Changed files: ${{ git diff --name-only HEAD 2>/dev/null || echo "(no changes)" }}

Run `npm run test:run` and provide:
- Total tests: passed/failed/skipped
- Any failing tests with error messages
- Suggestions for fixing failures

If a specific test file is provided as an argument, run only that file:
`npm run test:run -- <file>`
