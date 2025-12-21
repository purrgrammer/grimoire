# GitHub Actions Setup

This document describes the GitHub Actions workflows configured for this repository.

## Claude Code Review

The repository is configured with automated code reviews powered by Claude AI.

### How It Works

The Claude Code Review action triggers:
- **Automatically** on all pull requests (opened, synchronized, or reopened)
- **On-demand** when you comment `@claude` on a pull request

### Setup Requirements

#### 1. Add Anthropic API Key

You need to add your Anthropic API key as a repository secret:

1. Go to your repository Settings
2. Navigate to **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `ANTHROPIC_API_KEY`
5. Value: Your Anthropic API key (get one at https://console.anthropic.com)
6. Click **Add secret**

#### 2. Install Claude GitHub App (Optional)

For the easiest setup, you can install the official Claude GitHub app:
- Visit https://github.com/apps/claude
- Click "Install"
- Select your repository

Alternatively, use the CLI: Open Claude Code and run `/install-github-app`

### Review Focus Areas

Claude reviews focus on:

- **Code Quality**: Bugs, edge cases, error handling, security vulnerabilities
- **Architecture**: Adherence to project conventions (CLAUDE.md), proper use of EventStore/RelayLiveness singletons
- **Testing**: Coverage of parsers and pure functions
- **Performance**: Unnecessary re-renders, subscription leaks, optimization opportunities

### Permissions

The workflow uses these permissions:
- `contents: read` - Read repository code
- `pull-requests: write` - Post review comments on PRs
- `issues: write` - Respond to @claude mentions

### Customizing Reviews

To customize the review behavior, edit the `prompt` section in `.github/workflows/claude-code-review.yml`.

### Resources

- [Claude Code GitHub Actions Documentation](https://code.claude.com/docs/en/github-actions)
- [How to Use Claude Code for PRs and Code Reviews](https://skywork.ai/blog/how-to-use-claude-code-for-prs-code-reviews-guide/)
- [Integrating Claude Code with GitHub Actions](https://stevekinney.com/courses/ai-development/integrating-with-github-actions)
