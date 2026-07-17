"use client";

import { FormEvent, useState } from "react";
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

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ target: trimmedTarget }),
      });

      const payload = (await response.json()) as AnalyzeRepoResponse | { error: string };
      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Failed to analyze repository.");
      }

      setResult(payload as AnalyzeRepoResponse);
      setStatus("done");
    } catch (submissionError) {
      setStatus("error");
      setError(submissionError instanceof Error ? submissionError.message : "Unknown error.");
    }
  }

  return (
    <main className="page-shell">
      <section className="hero panel">
        <div className="hero__badge">OSS repo diligence</div>
        <h1>Evaluate one repo, not an entire org.</h1>
        <p>
          Pull a server-side GitHub analysis for a single repository, rotate between two Vercel
          GitHub tokens, and persist each snapshot to Neon so later refreshes can reuse cached PR
          history instead of re-downloading the whole 90-day window.
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

      {status === "loading" ? (
        <section className="panel loading-panel">
          <div className="spinner-wrap" aria-hidden="true">
            <div className="spinner spinner--outer" />
            <div className="spinner spinner--middle" />
            <div className="spinner spinner--inner" />
          </div>
          <h2>Refreshing repository snapshot</h2>
          <p>
            Pulling repo metadata, contributor signals, and the last 90 days of PR activity.
          </p>
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
