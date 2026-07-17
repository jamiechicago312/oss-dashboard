import { neon } from "@neondatabase/serverless";

type RepoSnapshotRecord = {
  payload: unknown;
  raw: unknown;
};

function getSql() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return null;
  }

  return neon(databaseUrl);
}

export function isSnapshotStoreConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function ensureSnapshotTable() {
  const sql = getSql();
  if (!sql) {
    return false;
  }

  await sql`
    CREATE TABLE IF NOT EXISTS repo_snapshots (
      id BIGSERIAL PRIMARY KEY,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL,
      raw JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS repo_snapshots_owner_repo_generated_idx
      ON repo_snapshots (owner, repo, generated_at DESC)
  `;

  return true;
}

export async function loadLatestSnapshot(owner: string, repo: string): Promise<RepoSnapshotRecord | null> {
  const sql = getSql();
  if (!sql) {
    return null;
  }

  const rows = await sql`
    SELECT payload, raw
    FROM repo_snapshots
    WHERE owner = ${owner.toLowerCase()}
      AND repo = ${repo.toLowerCase()}
    ORDER BY generated_at DESC
    LIMIT 1
  `;

  return (rows[0] as RepoSnapshotRecord | undefined) ?? null;
}

export async function saveSnapshot(
  owner: string,
  repo: string,
  generatedAt: string,
  payload: unknown,
  raw: unknown,
) {
  const sql = getSql();
  if (!sql) {
    return false;
  }

  await sql`
    INSERT INTO repo_snapshots (owner, repo, generated_at, payload, raw)
    VALUES (
      ${owner.toLowerCase()},
      ${repo.toLowerCase()},
      ${generatedAt},
      ${JSON.stringify(payload)}::jsonb,
      ${JSON.stringify(raw)}::jsonb
    )
  `;

  return true;
}
