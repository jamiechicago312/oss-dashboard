"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { AnalyzeRepoResponse } from "@/lib/github/types";

const numberFormat = new Intl.NumberFormat("en-US");

function formatNumber(value: number) {
  return numberFormat.format(value);
}

function formatDuration(hours: number | null) {
  if (hours === null || Number.isNaN(hours)) {
    return "N/A";
  }

  if (hours < 48) {
    return `${hours.toFixed(1)}h`;
  }

  return `${(hours / 24).toFixed(1)}d`;
}

function StatCard({
  label,
  value,
  tone = "blue",
  note,
}: {
  label: string;
  value: string;
  tone?: "blue" | "red" | "green" | "brown";
  note?: string;
}) {
  return (
    <article className={`stat-card stat-card--${tone}`}>
      <p>{label}</p>
      <h3>{value}</h3>
      {note ? <span>{note}</span> : null}
    </article>
  );
}

function MetricTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: string; note?: string }>;
}) {
  return (
    <section className="panel">
      <div className="panel__header">
        <h2>{title}</h2>
      </div>
      <div className="metric-table">
        {rows.map((row) => (
          <div key={row.label} className="metric-table__row">
            <div>
              <strong>{row.label}</strong>
              {row.note ? <p>{row.note}</p> : null}
            </div>
            <span>{row.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function DashboardShell() {
  const [target, setTarget] = useState("");
  const [result, setResult] = useState<AnalyzeRepoResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<"queued" | "running" | "completed" | "failed" | null>(
    null,
  );
  const [showingStaleResult, setShowingStaleResult] = useState(false);
  const pollIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!jobId || !jobStatus || jobStatus === "completed" || jobStatus === "failed") {
      if (pollIntervalRef.current !== null) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    const currentJobId = jobId;

    async function pollJob() {
      const response = await fetch(`/api/analyze/status?jobId=${encodeURIComponent(currentJobId)}`, {
        method: "GET",
      });

      const payload = (await response.json()) as {
        job?: { id: string; status: "queued" | "running" | "completed" | "failed"; errorMessage?: string | null };
        result?: AnalyzeRepoResponse | null;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to poll analysis job.");
      }

      if (!payload.job) {
        throw new Error("Job status payload was missing.");
      }

      setJobStatus(payload.job.status);

      if (payload.job.status === "completed" && payload.result) {
        setResult(payload.result);
        setShowingStaleResult(false);
        setStatus("done");
        setError(null);
      }

      if (payload.job.status === "failed") {
        setStatus("error");
        setError(payload.job.errorMessage ?? "Analysis refresh failed.");
      }
    }

    void pollJob();
    pollIntervalRef.current = window.setInterval(() => {
      void pollJob();
    }, 3000);

    return () => {
      if (pollIntervalRef.current !== null) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [jobId, jobStatus]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedTarget = target.trim();
    if (!trimmedTarget) {
      setError('Enter a GitHub repository in "owner/repo" format.');
      return;
    }

    setStatus("loading");
    setError(null);
    setResult(null);
    setJobId(null);
    setJobStatus(null);
    setShowingStaleResult(false);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ target: trimmedTarget }),
      });

      const payload = (await response.json()) as
        | {
            mode: "sync" | "async";
            result: AnalyzeRepoResponse | null;
            isStale: boolean;
            job: { id: string; status: "queued" | "running" | "completed" | "failed" } | null;
          }
        | { error: string };
      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Failed to analyze repository.");
      }

      if ("mode" in payload) {
        setResult(payload.result);
        setShowingStaleResult(payload.isStale);
        setJobId(payload.job?.id ?? null);
        setJobStatus(payload.job?.status ?? null);
        setStatus(payload.result ? "done" : "loading");
      }
    } catch (submissionError) {
      setStatus("error");
      setError(submissionError instanceof Error ? submissionError.message : "Unknown error.");
    }
  }

  return (
    <main className="page-shell">
      <section className="hero panel">
        <div className="hero__badge">OSS Dashboard</div>
        <h1>Open Source Contributor Evaluation</h1>
        <h2 className="hero__subtitle">Stop judging a project by stars</h2>
        <p>
          Use this dashboard to help evaluate your future open source contributor experience for a
          project. Keep in mind that your time is valuable, so let&apos;s make sure this project is
          worth your time. If you&apos;d like to contribute to this project or fork it, check out the{" "}
          <a
            href="https://github.com/jamiechicago312/oss-dashboard"
            target="_blank"
            rel="noreferrer"
          >
            GitHub Repo
          </a>
          .
        </p>

        <form onSubmit={onSubmit} className="search-form">
          <label htmlFor="target">GitHub repository</label>
          <div className="search-form__row">
            <input
              id="target"
              name="target"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="owner/repo"
              autoComplete="off"
            />
            <button type="submit">Analyze</button>
          </div>
        </form>

        <div className="hero__notes">
          <span>Uses `GITHUB_TOKEN_1` and `GITHUB_TOKEN_2` on the server.</span>
          <span>Writes snapshot backups to Neon when `DATABASE_URL` is configured.</span>
        </div>
      </section>

      {showingStaleResult && result ? (
        <section className="panel stale-panel">
          <h2>Showing cached snapshot while refresh runs</h2>
          <p>
            This result is from an older cached snapshot for <strong>{result.target.slug}</strong>.
            A fresh analysis job is running now, and this page will update automatically when it
            finishes.
          </p>
        </section>
      ) : null}

      {status === "loading" ? (
        <section className="panel loading-panel">
          <div className="progress-shell" aria-hidden="true">
            <div className="progress-track">
              <div className="progress-bar" />
            </div>
          </div>
          <h2>Refreshing repository snapshot</h2>
          <p>
            Pulling repo metadata, contributor signals, and the last 90 days of PR activity.
          </p>
          <p className="loading-note">
            This is an indeterminate progress bar. The app cannot predict exact completion time
            because GitHub response volume varies by repository and cache state.
          </p>
          {jobStatus ? <p className="loading-note">Current job status: {jobStatus}</p> : null}
        </section>
      ) : null}

      {error ? (
        <section className="panel error-panel">
          <h2>Request failed</h2>
          <p>{error}</p>
        </section>
      ) : null}

      {result ? (
        <div className="dashboard-grid">
          <section className="panel panel--wide">
            <div className="panel__header">
              <div>
                <h2>{result.target.slug}</h2>
                <p>
                  Snapshot created {new Date(result.snapshot.generatedAt).toLocaleString("en-US")}
                </p>
              </div>
              <div className="eyebrow-list">
                <span>{result.repository.defaultBranch} default branch</span>
                <span>{formatNumber(result.snapshot.tokensUsed)} tokens in rotation</span>
                <span>{result.snapshot.cacheHit ? "Cache warm" : "First cached run"}</span>
              </div>
            </div>

            <div className="stat-grid">
              <StatCard label="Stars" value={formatNumber(result.metrics.vanity.stars)} tone="blue" />
              <StatCard label="Forks" value={formatNumber(result.metrics.vanity.forks)} tone="brown" />
              <StatCard
                label="Contributors"
                value={formatNumber(result.metrics.vanity.contributors)}
                tone="green"
                note="Unique repo contributors from the contributors endpoint"
              />
              <StatCard
                label="Org members"
                value={formatNumber(result.metrics.vanity.orgMembers)}
                tone="red"
                note={
                  result.repository.ownerType === "Organization"
                    ? "Public org members plus observed MEMBER or OWNER PR authors"
                    : "User-owned repo: only observed OWNER associations are available"
                }
              />
            </div>
          </section>

          <MetricTable
            title="PR Activity"
            rows={[
              {
                label: "Last 90 days",
                value: formatNumber(result.metrics.pullRequests.totalLast90Days),
              },
              {
                label: "All-time opened",
                value: formatNumber(result.metrics.pullRequests.opened),
              },
              {
                label: "All-time merged",
                value: formatNumber(result.metrics.pullRequests.merged),
              },
              {
                label: "All-time closed",
                value: formatNumber(result.metrics.pullRequests.closed),
              },
            ]}
          />

          <MetricTable
            title="Contributor Experience"
            rows={[
              {
                label: "Average time to first review",
                value: formatDuration(result.metrics.contributorExperience.averageHoursToFirstReview),
              },
              {
                label: "Average time to merge",
                value: formatDuration(result.metrics.contributorExperience.averageHoursToMerge),
              },
              {
                label: "Repeat contributors",
                value: formatNumber(result.metrics.contributorExperience.repeatContributors),
                note: "External contributors with more than one PR in the 90-day window.",
              },
              {
                label: "Maintainers",
                value: formatNumber(result.metrics.contributorExperience.maintainers),
                note: "Inferred from public PR author associations.",
              },
              {
                label: "External contributors",
                value: formatNumber(result.metrics.contributorExperience.externalContributors),
              },
            ]}
          />

          <MetricTable
            title="Contributor Onramp"
            rows={[
              {
                label: "Contributing guide",
                value: result.metrics.contributorOnRamp.hasContributingGuide ? "Yes" : "No",
                note:
                  result.metrics.contributorOnRamp.contributingGuidePath ??
                  "No standard contributing guide detected.",
              },
              {
                label: "Maintainer guide",
                value: result.metrics.contributorOnRamp.hasMaintainerGuide ? "Yes" : "No",
                note:
                  result.metrics.contributorOnRamp.maintainerGuidePath ??
                  "No maintainer markdown file detected.",
              },
              {
                label: "Good first issue label",
                value: result.metrics.contributorOnRamp.goodFirstIssueLabel ?? "Not found",
              },
              {
                label: "Open good first issues",
                value: formatNumber(result.metrics.contributorOnRamp.openGoodFirstIssues),
              },
            ]}
          />

          <MetricTable
            title="Cache Reuse"
            rows={[
              {
                label: "Reused PR records",
                value: formatNumber(result.analysis.cache.reusedPullRequests),
              },
              {
                label: "Refreshed PR records",
                value: formatNumber(result.analysis.cache.refreshedPullRequests),
              },
              {
                label: "Reused review records",
                value: formatNumber(result.analysis.cache.reusedReviews),
              },
              {
                label: "Refreshed review records",
                value: formatNumber(result.analysis.cache.refreshedReviews),
                note:
                  result.snapshot.baseSnapshotGeneratedAt
                    ? `Base snapshot ${new Date(result.snapshot.baseSnapshotGeneratedAt).toLocaleString("en-US")}`
                    : "No prior snapshot existed.",
              },
            ]}
          />

          <section className="panel panel--wide">
            <div className="panel__header">
              <h2>Snapshot notes</h2>
            </div>
            <ul className="caveat-list">
              {result.snapshot.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </main>
  );
}
