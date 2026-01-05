Create a PR for the current changes.

Git status: ${{ git status --short }}
Current branch: ${{ git branch --show-current }}
Diff stats: ${{ git diff --stat HEAD~1 2>/dev/null || git diff --stat }}
Recent commits: ${{ git log --oneline -5 }}

Instructions:
1. Review the changes and stage relevant files
2. Create a commit with a clear, descriptive message following repo conventions
3. Push to the current branch (or create a new branch if on main)
4. Create a PR with:
   - Clear title summarizing the change
   - Summary section with bullet points
   - Test plan section describing how to verify

Do NOT push to main/master directly.
