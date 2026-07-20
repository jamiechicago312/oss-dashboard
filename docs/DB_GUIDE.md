# Database Setup Guide

This project uses Neon Postgres to store repository snapshots in a single table named `repo_snapshots`.

The app can run without a database, but you should configure Neon in Vercel if you want:

- durable backups of every repo query
- cache reuse between requests
- fewer repeated GitHub API calls on later refreshes

## What the app stores

For each `owner/repo` query, the app writes:

- the summarized payload returned to the UI
- the raw backing data used to build that payload
- the snapshot timestamp

Today that data is stored in:

- `repo_snapshots`

The table is created automatically by the app on first use if `DATABASE_URL` is configured.

## Required environment variables

Set these in Vercel:

```bash
GITHUB_TOKEN_1=
GITHUB_TOKEN_2=
DATABASE_URL=
```

Notes:

- `GITHUB_TOKEN_1` and `GITHUB_TOKEN_2` should come from two different GitHub accounts if you want separate primary rate-limit budgets.
- `DATABASE_URL` should be the Neon connection string for the database you want this app to use.
- Use the pooled Neon connection string unless you have a specific reason not to.

## Recommended Neon setup

1. Create a new Neon project.
2. Create or use the default database.
3. Copy the pooled connection string.
4. Add that connection string to Vercel as `DATABASE_URL`.
5. Redeploy the app.

If you are using separate Vercel environments, set `DATABASE_URL` independently for:

- Production
- Preview
- Development

Do not point unrelated environments at the same database unless that is intentional.

## How to add the database in Vercel

In Vercel:

1. Open the project.
2. Go to Settings.
3. Open Environment Variables.
4. Add `DATABASE_URL`.
5. Paste the Neon connection string.
6. Add `GITHUB_TOKEN_1`.
7. Add `GITHUB_TOKEN_2`.
8. Redeploy.

## Schema used by the app

The app creates this table automatically:

```sql
CREATE TABLE IF NOT EXISTS repo_snapshots (
  id BIGSERIAL PRIMARY KEY,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  raw JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS repo_snapshots_owner_repo_generated_idx
  ON repo_snapshots (owner, repo, generated_at DESC);
```

You do not need to run this manually unless you want to pre-provision the table yourself.

## How the cache works

On the first query for a repo:

- the app fetches the current GitHub data
- builds the response
- writes a snapshot row to Neon

On a later query for the same repo:

- the app loads the latest saved snapshot
- reuses cached PR and review history where possible
- fetches newer GitHub changes
- writes a new snapshot row

This means the database acts as both:

- a backup history of repo analyses
- a working cache for incremental refreshes

## How to verify the DB is working

After deployment, query any repo once from the app, then inspect Neon:

```sql
SELECT owner, repo, generated_at, created_at
FROM repo_snapshots
ORDER BY created_at DESC
LIMIT 20;
```

You should see rows appear after each successful analysis.

To inspect the newest snapshot for one repo:

```sql
SELECT generated_at, payload, raw
FROM repo_snapshots
WHERE owner = 'vercel' AND repo = 'next.js'
ORDER BY generated_at DESC
LIMIT 1;
```

## Operational guidance

- Expect `raw` to grow over time because it stores backing API data.
- If storage starts growing too quickly, add a retention policy later.
- If you want stronger queryability later, split parts of `raw` into normalized tables.
- For now, JSONB is the right tradeoff because the product is still moving.

## Suggested retention follow-up

If snapshot volume becomes large, add one of these later:

- keep only the latest snapshot per repo
- keep the latest snapshot plus daily history
- keep the latest N snapshots per repo

That is not implemented in this PR.

## Failure modes

If `DATABASE_URL` is missing:

- the app still works
- snapshots are not persisted
- incremental DB-backed cache reuse is disabled

If GitHub tokens are missing:

- the app still attempts requests
- GitHub rate limits will be much lower

If Neon is configured incorrectly:

- analysis may fail when the app tries to initialize or write snapshots

## Local development

Create `.env.local`:

```bash
GITHUB_TOKEN_1=...
GITHUB_TOKEN_2=...
DATABASE_URL=...
```

Then run:

```bash
npm install
npm run dev
```

## Current implementation files

Relevant files in this repo:

- `lib/neon/snapshots.ts`
- `lib/github/analyze-org.ts`
- `app/api/analyze/route.ts`

## Future improvements

Reasonable next steps:

- add retention / pruning
- normalize frequently queried snapshot fields
- add snapshot age and row-count admin views
- cache contributor and on-ramp lookups more aggressively
