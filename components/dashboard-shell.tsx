"use client";

import { useEffect, useMemo, useState } from "react";
import type { AnalyzeOrgResponse } from "@/lib/github/types";

const numberFormat = new Intl.NumberFormat("en-US");
const DEMO_TIMESTAMP_LABEL = "Data is current as of July 3, 2026 17:42 UTC-4.";
const DEMO_TARGETS = [
  {
    id: "nodejs",
    label: "Node.js Org",
    description: "nodejs",
    dataPath: "/demo-data/nodejs.json",
  },
  {
    id: "microsoft-powertoys",
    label: "PowerToys Repo",
    description: "microsoft/PowerToys",
    dataPath: "/demo-data/microsoft-powertoys.json",
  },
  {
    id: "forpublicai",
    label: "ForPublicAI Org",
    description: "forpublicai",
    dataPath: "/demo-data/forpublicai.json",
  },
  {
    id: "tailwindlabs",
    label: "Tailwind Labs Org",
    description: "tailwindlabs",
    dataPath: "/demo-data/tailwindlabs.json",
  },
] as const;

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
  const [activeTargetId, setActiveTargetId] = useState<(typeof DEMO_TARGETS)[number]["id"]>(
    DEMO_TARGETS[0].id,
  );
  const [result, setResult] = useState<AnalyzeOrgResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function loadDemoTarget(targetId: (typeof DEMO_TARGETS)[number]["id"]) {
    const selectedTarget = DEMO_TARGETS.find((target) => target.id === targetId);
    if (!selectedTarget) {
      setError("Unknown demo target.");
      return;
    }

    setActiveTargetId(targetId);
    setStatus("loading");
    setError(null);
    setResult(null);

    try {
      const response = await fetch(selectedTarget.dataPath, {
        cache: "no-store",
      });
      const payload = (await response.json()) as AnalyzeOrgResponse | { error: string };
      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Failed to load demo snapshot.");
      }

      setResult(payload as AnalyzeOrgResponse);
      setStatus("done");
    } catch (submissionError) {
      setStatus("error");
      setError(submissionError instanceof Error ? submissionError.message : "Unknown error.");
    }
  }

  useEffect(() => {
    void loadDemoTarget(DEMO_TARGETS[0].id);
  }, []);

  const actorRows = useMemo(() => {
    if (!result) {
      return [];
    }

    return [
      {
        label: "External contributor PRs",
        value: `${formatNumber(result.analysis.pullRequests.byActor.external.count)} (${result.analysis.pullRequests.byActor.external.percent}%)`,
      },
      {
        label: "Maintainer PRs",
        value: `${formatNumber(result.analysis.pullRequests.byActor.maintainer.count)} (${result.analysis.pullRequests.byActor.maintainer.percent}%)`,
      },
      {
        label: "Org member PRs",
        value: `${formatNumber(result.analysis.pullRequests.byActor.orgMember.count)} (${result.analysis.pullRequests.byActor.orgMember.percent}%)`,
      },
      {
        label: "Unknown PRs",
        value: `${formatNumber(result.analysis.pullRequests.byActor.unknown.count)} (${result.analysis.pullRequests.byActor.unknown.percent}%)`,
      },
    ];
  }, [result]);

  const contributorReadinessRows = useMemo(() => {
    if (!result) {
      return [];
    }

    return result.analysis.contributorReadiness.topGoodFirstIssueRepos.map((repo) => ({
      label: repo.repo,
      value: formatNumber(repo.openGoodFirstIssues),
      note: repo.hasContributingGuide
        ? `Contributing guide: ${repo.contributingGuidePath ?? "detected"}`
        : "No standard contributing guide detected.",
    }));
  }, [result]);

  const missingGuidePreview = useMemo(() => {
    if (!result) {
      return "None";
    }

    const missing = result.analysis.contributorReadiness.reposMissingContributingGuide.slice(0, 6);
    if (missing.length === 0) {
      return "None";
    }

    return missing.join(", ");
  }, [result]);

  return (
    <main className="page-shell">
      <section className="hero panel">
        <div className="hero__badge">OSS due diligence</div>
        <h1>Ride the perimeter before you commit to the ranch.</h1>
        <p>
          Inspect three fixed GitHub snapshots prepared for demo review. Each button loads a
          committed local JSON snapshot so the deployed demo stays fast and deterministic.
        </p>

        <div className="target-picker">
          <p className="target-picker__label">Choose a demo snapshot</p>
          <div className="target-picker__grid">
            {DEMO_TARGETS.map((target) => (
              <button
                key={target.id}
                type="button"
                className={target.id === activeTargetId ? "target-button is-active" : "target-button"}
                onClick={() => {
                  void loadDemoTarget(target.id);
                }}
              >
                <strong>{target.label}</strong>
                <span>{target.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="hero__notes">
          <span>Demo targets are fixed for this deployment.</span>
          <span>{DEMO_TIMESTAMP_LABEL}</span>
        </div>
      </section>

      {status === "loading" ? (
        <section className="panel loading-panel">
          <div className="spinner-wrap" aria-hidden="true">
            <div className="spinner spinner--outer" />
            <div className="spinner spinner--middle" />
            <div className="spinner spinner--inner" />
          </div>
          <h2>Surveying the territory</h2>
          <p>
            Pulling repos, contributors, PR totals, contributor-onramp signals, and 90-day review
            latency metrics.
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
                <span>
                  {formatNumber(result.org.publicRepos)}{" "}
                  {result.target.kind === "repo" ? "repo analyzed" : "public repos"}
                </span>
                <span>{formatNumber(result.org.archivedRepos)} archived repos</span>
                <span>{formatNumber(result.snapshot.tokensUsed)} GitHub tokens in rotation</span>
              </div>
            </div>

            <div className="stat-grid">
              <StatCard
                label="Stars"
                value={formatNumber(result.metrics.vanity.stars)}
                tone="blue"
              />
              <StatCard
                label="Forks"
                value={formatNumber(result.metrics.vanity.forks)}
                tone="brown"
              />
              <StatCard
                label="Repo contributors"
                value={formatNumber(result.metrics.people.uniqueRepoContributors)}
                tone="green"
                note="Unique commit contributors across repos"
              />
              <StatCard
                label="Org members"
                value={formatNumber(result.metrics.people.orgMembers)}
                tone="red"
                note={
                  result.target.kind === "repo"
                    ? "Observed MEMBER or OWNER PR authors"
                    : "Public plus observed MEMBER or OWNER PR authors"
                }
              />
            </div>
          </section>

          <MetricTable
            title="PR Totals"
            rows={[
              {
                label: "Opened",
                value: formatNumber(result.metrics.pullRequestTotals.opened),
              },
              {
                label: "Merged",
                value: formatNumber(result.metrics.pullRequestTotals.merged),
              },
              {
                label: "Closed",
                value: formatNumber(result.metrics.pullRequestTotals.closed),
              },
              {
                label: "Analyzed window",
                value: result.analysis.window.label,
                note: "Recent PR analysis operates over the last 90 days.",
              },
            ]}
          />

          <MetricTable title="Actor Mix" rows={actorRows} />

          <MetricTable
            title="Contributor Experience"
            rows={[
              {
                label: "Average time to first review",
                value: formatDuration(result.analysis.externalContributors.averageHoursToFirstReview),
              },
              {
                label: "Average time to merge",
                value: formatDuration(result.analysis.externalContributors.averageHoursToMerge),
              },
              {
                label: "Repeat contributors",
                value: formatNumber(result.analysis.externalContributors.repeatContributors),
                note: "External contributors with more than one PR in the 90-day window.",
              },
              {
                label: "Unique contributors",
                value: formatNumber(result.analysis.externalContributors.uniqueContributors),
              },
            ]}
          />

          <MetricTable
            title="Role Coverage"
            rows={[
              {
                label: "Maintainers",
                value: formatNumber(result.metrics.people.maintainers),
                note: "Approximation based on public PR/review associations.",
              },
              {
                label: "External contributors",
                value: formatNumber(result.metrics.people.externalContributors),
                note: "Maintainers and public org members removed from this set.",
              },
              {
                label: "Repos with contributing guides",
                value: formatNumber(result.metrics.contributorReadiness.reposWithContributingGuide),
                note: "Detected through GitHub community profile data.",
              },
            ]}
          />

          <MetricTable
            title="Contributor Onramp"
            rows={[
              {
                label: "Open good first issues",
                value: formatNumber(result.metrics.contributorReadiness.openGoodFirstIssues),
              },
              {
                label: "Repos with good first issue labels",
                value: formatNumber(
                  result.metrics.contributorReadiness.reposWithGoodFirstIssueLabel,
                ),
              },
              {
                label: "Repos with open good first issues",
                value: formatNumber(
                  result.metrics.contributorReadiness.reposWithOpenGoodFirstIssues,
                ),
              },
              {
                label: "Repos missing contributing guides",
                value: formatNumber(
                  result.metrics.contributorReadiness.reposWithoutContributingGuide,
                ),
                note: missingGuidePreview,
              },
            ]}
          />

          <MetricTable
            title="Top Good First Issue Repos"
            rows={
              contributorReadinessRows.length > 0
                ? contributorReadinessRows
                : [
                    {
                      label: "No open good first issues found",
                      value: "0",
                      note: "Either no matching label exists or no open issues currently use it.",
                    },
                  ]
            }
          />

          <section className="panel panel--wide">
            <div className="panel__header">
              <h2>Snapshot caveats</h2>
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
