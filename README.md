# OSS Dashboard

Next.js dashboard for evaluating one GitHub repository at a time.

## Product direction

- Repo-only analysis. Org-wide scans are intentionally out.
- Server-side GitHub access using exactly two env-var tokens.
- Neon-backed snapshot storage on every query.
- Incremental reuse of cached PR and review history so refreshes do not need to pull the full 90-day window every time.

## What it tracks

- Vanity metrics: stars, forks, org members, contributor count
- PR activity: all-time opened, merged, closed, plus the last 90 days
- Contributor experience: time to first review, time to merge, repeat contributor count, maintainer count
- Contributor on-ramp: contributing guide, maintainer guide, good first issue label, open good first issues

## What it does not track anymore

- Org-wide analysis
- Actor mix
- Role coverage section
- Top good first issue repos

## Environment

Copy `.env.example` to `.env.local` and set:

```bash
GITHUB_TOKEN_1=
GITHUB_TOKEN_2=
DATABASE_URL=
```

Notes:

- `GITHUB_TOKEN_1` and `GITHUB_TOKEN_2` should come from different GitHub accounts if you want separate primary rate-limit budgets.
- `DATABASE_URL` should point to your Neon Postgres database.
- If `DATABASE_URL` is missing, the app still runs but skips snapshot persistence and incremental cache reuse.

## Local development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000` and query a repository in `owner/repo` format.

## Storage model

Each request writes a row into `repo_snapshots` with:

- the summary payload returned to the UI
- raw PR, review, contributor, and on-ramp data used to build that payload

On the next request for the same repo, the app loads the most recent snapshot from Neon and reuses cached PR/review history where possible before fetching only the latest changes from GitHub.

## Scripts

- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run typecheck`
