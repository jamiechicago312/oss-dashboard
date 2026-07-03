# OSS Dashboard

Local Next.js dashboard for evaluating whether a GitHub organization or single repository looks
healthy enough to contribute to.

## What it does

- Pulls either every public repo in a GitHub organization or a single target repository.
- Aggregates vanity metrics like stars and forks.
- Computes org-wide PR totals across all public repos.
- Analyzes the last 90 days of PRs to estimate actor mix:
  external contributors, maintainers, and org members.
- Measures contributor experience:
  average time to first review, average time to merge, and repeat contributor count.
- Counts open `good first issue` issues across the org and shows which repos currently expose them.
- Detects whether repos publish a standard contributing guide through GitHub's community profile.
- Stores snapshots as committed JSON under `data/orgs/<org>/`.

## What it does not pretend to know

- Exact collaborator permission breakdowns like read-only, triage-only, and write across arbitrary
  public repositories are not fully public. The dashboard labels those counts as approximations
  when they are derived from PR author association.
- Org member counts combine public membership visibility with users observed as `MEMBER` or
  `OWNER` on recent PRs. That is useful, but not perfect.
- Contribution guide detection follows GitHub's standard community profile signals, so unusual file
  locations may not be recognized.

## Setup

1. Copy `.env.example` to `.env`.
2. Add up to four GitHub API tokens:
   `GITHUB_TOKEN_1`, `GITHUB_TOKEN_2`, `GITHUB_TOKEN_3`, `GITHUB_TOKEN_4`.
   Tokens from the same GitHub user do not create a separate primary rate-limit budget, so for
   very large orgs you need either fewer API calls, tokens from different users, or a GitHub App
   installation token strategy.
3. Install dependencies:

```bash
npm install
```

4. Start the local app:

```bash
npm run dev
```

5. Open [http://127.0.0.1:3000](http://127.0.0.1:3000)

## Scripts

- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run typecheck`

## Snapshot output

Each analysis writes two files:

- `data/orgs/<org>/<timestamp>.json` for org scans
- `data/repos/<owner>/<repo>/<timestamp>.json` for repo scans

A `latest.json` file is also written alongside each target and used as a fallback if a later live
refresh hits GitHub rate limits.

The JSON includes both summary metrics used by the UI and the raw fetched payloads needed for
inspection or future reprocessing.
