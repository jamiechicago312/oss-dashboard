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

function formatPercentageChange(value: number | null) {
  if (value === null) {
    return "New or no prior value";
  }

  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
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
  const [showingDailyCacheResult, setShowingDailyCacheResult] = useState(false);
  const pollIntervalRef = useRef<number | null>(null);
  const metricChanges = result?.comparison?.metrics ?? [];
  const previousSnapshotGeneratedAt = result?.comparison?.previousSnapshotGeneratedAt ?? null;

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
    setShowingDailyCacheResult(false);

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
            mode: "sync" | "async" | "cached";
            result: AnalyzeRepoResponse | null;
            isStale: boolean;
            rateLimited: boolean;
            job: { id: string; status: "queued" | "running" | "completed" | "failed" } | null;
          }
        | { error: string };
      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Failed to analyze repository.");
      }

      if ("mode" in payload) {
        setResult(payload.result);
        setShowingStaleResult(payload.isStale);
        setShowingDailyCacheResult(payload.rateLimited);
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
        <h1>
          Open Source<br />
          Contributor<br />
          Evaluation
        </h1>
        <h2 className="hero__subtitle">Choose projects worth contributing to.</h2>
        <p>
          Open source is an investment of your time. This dashboard helps you evaluate contributor
          experience, maintainer responsiveness, documentation quality, and overall project health
          before you write your first pull request.
        </p>
        <a
          className="hero__github-link"
          href="https://github.com/jamiechicago312/oss-dashboard"
          target="_blank"
          rel="noreferrer"
        >
          View on GitHub
        </a>

        <form onSubmit={onSubmit} className="search-form">
          <div className="search-form__row">
            <input
              id="target"
              name="target"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="jamiechicago312/oss-dashboard"
              autoComplete="off"
            />
            <button
              type="submit"
              className={status === "loading" ? "is-loading" : undefined}
              disabled={status === "loading"}
            >
              {status === "loading" ? "Analyzing…" : "Analyze"}
            </button>
          </div>
        </form>
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

      {showingDailyCacheResult && result ? (
        <section className="panel daily-cache-panel">
          <h2>Showing today&apos;s cached analysis</h2>
          <p>
            <strong>{result.target.slug}</strong> was already analyzed during the current UTC
            calendar day. To keep repository requests to one per day, this cached snapshot is
            being shown instead. A new analysis can run after 00:01 UTC.
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
          <p className="loading-note">
            Large repositories can take 5–10 minutes to analyze. Keep this page open and it will
            update automatically when the analysis is ready.
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

          {metricChanges.length > 0 ? (
            <section className="panel panel--wide comparison-panel">
              <div className="panel__header">
                <div>
                  <h2>Changes since previous snapshot</h2>
                  <p>
                    Previous cache: {" "}
                    {previousSnapshotGeneratedAt
                      ? new Date(previousSnapshotGeneratedAt).toLocaleString("en-US")
                      : "Unavailable"}
                  </p>
                </div>
              </div>
              <div className="comparison-table" role="table" aria-label="Snapshot metric changes">
                <div className="comparison-table__row comparison-table__header" role="row">
                  <span role="columnheader">Metric</span>
                  <span role="columnheader">Previous</span>
                  <span role="columnheader">Current</span>
                  <span role="columnheader">Change</span>
                </div>
                {metricChanges.map((change) => (
                  <div className="comparison-table__row" role="row" key={change.label}>
                    <strong role="cell">{change.label}</strong>
                    <span role="cell">{formatNumber(change.previousValue)}</span>
                    <span role="cell">{formatNumber(change.currentValue)}</span>
                    <span role="cell" className={`comparison-change comparison-change--${change.tone}`}>
                      {formatPercentageChange(change.percentageChange)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

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
