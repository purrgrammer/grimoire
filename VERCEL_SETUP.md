# Vercel Deploy Preview Setup

This guide walks you through setting up automatic deploy previews on Vercel for every pull request.

## Prerequisites

- GitHub repository with push access
- Vercel account (free tier works fine)

## Setup Steps

### 1. Connect Repository to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with your GitHub account
2. Click "Add New..." → "Project"
3. Import your `purrgrammer/grimoire` repository
4. Vercel will auto-detect the Vite framework settings (already configured in `vercel.json`)

### 2. Configure Project Settings

Vercel should automatically detect:
- **Framework Preset**: Vite
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Install Command**: `npm ci`

If not auto-detected, these are already specified in `vercel.json`.

### 3. Deploy

1. Click "Deploy" to create your first production deployment
2. Vercel will build and deploy your main branch

### 4. Enable PR Previews (Auto-Enabled)

By default, Vercel automatically:
- Creates a preview deployment for every PR
- Updates the preview on every commit to the PR
- Posts deployment status and preview URL as a comment on the PR
- Runs builds in parallel with GitHub Actions

### 5. Configure GitHub Integration (Optional)

In your Vercel project settings → Git:
- ✅ **Production Branch**: Set to `main` (or your default branch)
- ✅ **Preview Deployments**: Enabled for all branches
- ✅ **Auto-assign Custom Domains**: Enabled
- ✅ **Comments on Pull Requests**: Enabled
- ✅ **Deployment Protection**: Configure as needed

## How It Works

Once configured, for every PR:

1. Developer opens a PR → Vercel automatically builds and deploys
2. Vercel posts a comment with the preview URL
3. New commits to the PR → Vercel rebuilds and updates the preview
4. PR merged → Vercel deploys to production

## Preview URL Format

- **Production**: `grimoire.vercel.app` (or your custom domain)
- **PR Previews**: `grimoire-git-<branch-name>-<team>.vercel.app`
- **Unique deployment**: `grimoire-<hash>.vercel.app`

## Environment Variables

If your app needs environment variables:

1. Go to Project Settings → Environment Variables
2. Add variables for:
   - **Production** (main branch)
   - **Preview** (PR branches)
   - **Development** (local dev)

## Configuration Files

- **`vercel.json`**: Build settings, rewrites, headers, caching
- **`.vercelignore`**: Files to exclude from deployment

## Troubleshooting

### Build Fails on Vercel

Check the build logs in Vercel dashboard. Common issues:
- Missing environment variables
- TypeScript errors (ensure `npm run build` works locally)
- Node version mismatch (Vercel uses Node 20 by default)

### Preview Not Created

Ensure:
- GitHub integration is connected
- Repository has proper permissions in Vercel
- PR is targeting the correct base branch

### Changes Not Reflected

- Clear Vercel cache: Project Settings → Clear Cache
- Redeploy from the Deployments tab

## Security Notes

- Preview deployments are **publicly accessible** by default
- Use Vercel's Deployment Protection for sensitive projects
- Never commit secrets to the repository

## Additional Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Vercel Git Integration](https://vercel.com/docs/concepts/git)
- [Preview Deployments](https://vercel.com/docs/concepts/deployments/preview-deployments)
