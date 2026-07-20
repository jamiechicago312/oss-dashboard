import { neon } from "@neondatabase/serverless";
import type { AnalyzeRepoResponse } from "@/lib/github/types";
import { loadLatestSnapshot } from "@/lib/neon/snapshots";

export type AnalysisJobStatus = "queued" | "running" | "completed" | "failed";

export type AnalysisJobRecord = {
  id: string;
  owner: string;
  repo: string;
  status: AnalysisJobStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
};

function getSql() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return null;
  }

  return neon(databaseUrl);
}

export async function ensureAnalysisJobsTable() {
  const sql = getSql();
  if (!sql) {
    return false;
  }

  await sql`
    CREATE TABLE IF NOT EXISTS analysis_jobs (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ NULL,
      completed_at TIMESTAMPTZ NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS analysis_jobs_owner_repo_status_idx
      ON analysis_jobs (owner, repo, status, created_at DESC)
  `;

  return true;
}

export async function createAnalysisJob(owner: string, repo: string) {
  const sql = getSql();
  if (!sql) {
    return null;
  }

  const id = crypto.randomUUID();

  await sql`
    INSERT INTO analysis_jobs (id, owner, repo, status)
    VALUES (${id}, ${owner.toLowerCase()}, ${repo.toLowerCase()}, 'queued')
  `;

  return id;
}

export async function getActiveAnalysisJob(owner: string, repo: string): Promise<AnalysisJobRecord | null> {
  const sql = getSql();
  if (!sql) {
    return null;
  }

  const rows = await sql`
    SELECT id, owner, repo, status, error_message, created_at, updated_at, started_at, completed_at
    FROM analysis_jobs
    WHERE owner = ${owner.toLowerCase()}
      AND repo = ${repo.toLowerCase()}
      AND status IN ('queued', 'running')
    ORDER BY created_at DESC
    LIMIT 1
  `;

  return (rows[0] as AnalysisJobRecord | undefined) ?? null;
}

export async function getAnalysisJob(jobId: string): Promise<AnalysisJobRecord | null> {
  const sql = getSql();
  if (!sql) {
    return null;
  }

  const rows = await sql`
    SELECT id, owner, repo, status, error_message, created_at, updated_at, started_at, completed_at
    FROM analysis_jobs
    WHERE id = ${jobId}
    LIMIT 1
  `;

  return (rows[0] as AnalysisJobRecord | undefined) ?? null;
}

export async function markAnalysisJobRunning(jobId: string) {
  const sql = getSql();
  if (!sql) {
    return false;
  }

  await sql`
    UPDATE analysis_jobs
    SET status = 'running', started_at = NOW(), updated_at = NOW(), error_message = NULL
    WHERE id = ${jobId}
  `;

  return true;
}

export async function markAnalysisJobCompleted(jobId: string) {
  const sql = getSql();
  if (!sql) {
    return false;
  }

  await sql`
    UPDATE analysis_jobs
    SET status = 'completed', completed_at = NOW(), updated_at = NOW(), error_message = NULL
    WHERE id = ${jobId}
  `;

  return true;
}

export async function markAnalysisJobFailed(jobId: string, errorMessage: string) {
  const sql = getSql();
  if (!sql) {
    return false;
  }

  await sql`
    UPDATE analysis_jobs
    SET status = 'failed', completed_at = NOW(), updated_at = NOW(), error_message = ${errorMessage}
    WHERE id = ${jobId}
  `;

  return true;
}

export async function getCompletedJobResult(jobId: string): Promise<AnalyzeRepoResponse | null> {
  const job = await getAnalysisJob(jobId);
  if (!job || job.status !== "completed") {
    return null;
  }

  const snapshot = await loadLatestSnapshot(job.owner, job.repo);
  return (snapshot?.payload as AnalyzeRepoResponse | undefined) ?? null;
}
