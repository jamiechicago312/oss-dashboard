import { GitHubClientPool } from "@/lib/github/client";
import {
  ensureSnapshotTable,
  isSnapshotStoreConfigured,
  loadLatestSnapshot,
  saveSnapshot,
} from "@/lib/neon/snapshots";
import type {
  AnalyzeRepoResponse,
  OrgRepo,
  PullRequestReview,
  PullRequestSummary,
  RepoReadinessSummary,
  SnapshotMetricChange,
} from "@/lib/github/types";

type PublicMember = {
  login: string;
};

type RepoContributor = {
  login?: string;
  type?: string;
};

type GraphQlRepoCounts = {
  data: {
    repository: {
      opened: { totalCount: number };
      merged: { totalCount: number };
      closed: { totalCount: number };
    } | null;
  };
};

type RepoLabel = {
  name: string;
};

type IssueSummary = {
  id: number;
  pull_request?: Record<string, unknown>;
};

type CommunityProfile = {
  files?: {
    contributing?: {
      path?: string | null;
    } | null;
  } | null;
};

type ContentFile = {
  path?: string;
  type?: string;
};

type CachedRawSnapshot = {
  publicMembers?: PublicMember[];
  repoContributors?: RepoContributor[];
  repoPullCounts?: {
    opened: number;
    merged: number;
    closed: number;
  };
  recentPullRequests?: PullRequestSummary[];
  pullRequestReviews?: Array<{ number: number; reviews: PullRequestReview[] }>;
  contributorReadiness?: RepoReadinessSummary;
};

type CachedSnapshot = {
  payload: AnalyzeRepoResponse;
  raw: CachedRawSnapshot;
};

const ANALYSIS_WINDOW_DAYS = 90;
const CONTRIBUTING_GUIDE_CANDIDATES = [
  ".github/CONTRIBUTING.md",
  "CONTRIBUTING.md",
  "docs/CONTRIBUTING.md",
  ".github/contributing.md",
  "contributing.md",
  "docs/contributing.md",
];
const MAINTAINER_GUIDE_CANDIDATES = [
  ".github/MAINTAINERS.md",
  "MAINTAINERS.md",
  "docs/MAINTAINERS.md",
  ".github/MAINTAINER.md",
  "MAINTAINER.md",
  "docs/MAINTAINER.md",
  ".github/maintainers.md",
  "maintainers.md",
  "docs/maintainers.md",
];

function isRateLimitError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.includes("rate limit") ||
      error.message.includes("secondary rate limit") ||
      error.message.includes("GitHub request failed (403)") ||
      error.message.includes("GitHub request failed (429)"))
  );
}

function compareMetric(
  label: string,
  previousValue: number,
  currentValue: number,
  favorableDirection: "increase" | "decrease" | "unknown",
): SnapshotMetricChange {
  const difference = currentValue - previousValue;
  const percentageChange = previousValue === 0 ? null : (difference / Math.abs(previousValue)) * 100;
  const tone =
    difference === 0 || favorableDirection === "unknown"
      ? "neutral"
      : (difference > 0) === (favorableDirection === "increase")
        ? "positive"
        : "negative";

  return { label, previousValue, currentValue, percentageChange, tone };
}

function buildMetricChanges(
  previous: AnalyzeRepoResponse | undefined,
  current: AnalyzeRepoResponse,
): SnapshotMetricChange[] {
  if (!previous) {
    return [];
  }

  const changes = [
    compareMetric("Stars", previous.metrics.vanity.stars, current.metrics.vanity.stars, "increase"),
    compareMetric("Forks", previous.metrics.vanity.forks, current.metrics.vanity.forks, "unknown"),
    compareMetric(
      "Contributors",
      previous.metrics.vanity.contributors,
      current.metrics.vanity.contributors,
      "increase",
    ),
    compareMetric(
      "PRs merged",
      previous.metrics.pullRequests.merged,
      current.metrics.pullRequests.merged,
      "increase",
    ),
    compareMetric(
      "Repeat contributors",
      previous.metrics.contributorExperience.repeatContributors,
      current.metrics.contributorExperience.repeatContributors,
      "increase",
    ),
    compareMetric(
      "External contributors",
      previous.metrics.contributorExperience.externalContributors,
      current.metrics.contributorExperience.externalContributors,
      "increase",
    ),
    compareMetric(
      "Open good first issues",
      previous.metrics.contributorOnRamp.openGoodFirstIssues,
      current.metrics.contributorOnRamp.openGoodFirstIssues,
      "unknown",
    ),
  ];

  const previousFirstReview = previous.metrics.contributorExperience.averageHoursToFirstReview;
  const currentFirstReview = current.metrics.contributorExperience.averageHoursToFirstReview;
  if (previousFirstReview !== null && currentFirstReview !== null) {
    changes.splice(
      4,
      0,
      compareMetric("Time to first review", previousFirstReview, currentFirstReview, "decrease"),
    );
  }

  const previousMerge = previous.metrics.contributorExperience.averageHoursToMerge;
  const currentMerge = current.metrics.contributorExperience.averageHoursToMerge;
  if (previousMerge !== null && currentMerge !== null) {
    changes.splice(5, 0, compareMetric("Time to merge", previousMerge, currentMerge, "decrease"));
  }

  return changes;
}

async function runStage<T>(
  label: string,
  work: () => Promise<T>,
  fallback: T,
  notes: string[],
) {
  try {
    return await work();
  } catch (error) {
    if (isRateLimitError(error)) {
      notes.push(`${label} was skipped because GitHub rate limits were reached during this refresh.`);
      return fallback;
    }

    notes.push(`${label} was skipped because GitHub returned incomplete or invalid data.`);
    return fallback;
  }
}

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results: R[] = [];

  for (const itemGroup of chunk(items, Math.max(concurrency, 1))) {
    const groupResults = await Promise.all(itemGroup.map((item) => mapper(item)));
    results.push(...groupResults);
  }

  return results;
}

async function paginate<T>(
  fetchPage: (page: number) => Promise<T[]>,
  shouldContinue?: (pageItems: T[]) => boolean,
) {
  const items: T[] = [];

  for (let page = 1; ; page += 1) {
    const pageItems = await fetchPage(page);
    items.push(...pageItems);

    if (pageItems.length < 100) {
      break;
    }

    if (shouldContinue && !shouldContinue(pageItems)) {
      break;
    }
  }

  return items;
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function normalizeLabelName(value: string) {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

function isGoodFirstIssueLabel(value: string) {
  return normalizeLabelName(value) === "goodfirstissue";
}

function isExternalAssociation(association: string) {
  return ["CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "NONE"].includes(association);
}

function isMaintainerAssociation(association: string) {
  return association === "COLLABORATOR" || association === "OWNER";
}

function isObservedOrgMemberAssociation(association: string) {
  return association === "MEMBER" || association === "OWNER";
}

function parseTarget(input: string) {
  const normalized = input.trim().replace(/^\/+|\/+$/g, "");
  const segments = normalized.split("/").filter(Boolean);

  if (segments.length !== 2) {
    throw new Error('Enter a GitHub repository in "owner/repo" format.');
  }

  const [owner, repo] = segments;
  return {
    owner,
    repo,
    slug: `${owner}/${repo}`,
  };
}

function parseCachedSnapshot(snapshot: unknown): CachedSnapshot | null {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  const candidate = snapshot as CachedSnapshot;
  if (!candidate.payload || !candidate.raw) {
    return null;
  }

  return candidate;
}

async function fetchSingleRepo(client: GitHubClientPool, owner: string, repo: string) {
  return client.rest<OrgRepo>({
    path: `/repos/${owner}/${repo}`,
  });
}

async function fetchPublicOrgMembers(client: GitHubClientPool, org: string) {
  return paginate<PublicMember>((page) =>
    client.rest<PublicMember[]>({
      path: `/orgs/${org}/public_members`,
      query: {
        per_page: 100,
        page,
      },
    }),
  );
}

async function fetchRepoContributors(client: GitHubClientPool, owner: string, repo: string) {
  return paginate<RepoContributor>((page) =>
    client.rest<RepoContributor[]>({
      path: `/repos/${owner}/${repo}/contributors`,
      query: {
        per_page: 100,
        page,
        anon: "false",
      },
    }),
  );
}

async function fetchRepoPullRequestCounts(client: GitHubClientPool, owner: string, repo: string) {
  const payload = await client.graphQl<GraphQlRepoCounts>({
    query: `
      query RepoPullRequestCounts($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          opened: pullRequests(states: OPEN) { totalCount }
          merged: pullRequests(states: MERGED) { totalCount }
          closed: pullRequests(states: CLOSED) { totalCount }
        }
      }
    `,
    variables: {
      owner,
      repo,
    },
  });

  if (!payload.data.repository) {
    return { opened: 0, merged: 0, closed: 0 };
  }

  return {
    opened: payload.data.repository.opened.totalCount,
    merged: payload.data.repository.merged.totalCount,
    closed: payload.data.repository.closed.totalCount,
  };
}

async function fetchRepoLabels(client: GitHubClientPool, owner: string, repo: string) {
  return paginate<RepoLabel>(async (page) => {
    const labels = await client.restOptional<RepoLabel[]>(
      {
        path: `/repos/${owner}/${repo}/labels`,
        query: {
          per_page: 100,
          page,
        },
      },
      [404],
    );

    return labels ?? [];
  });
}

async function fetchOpenIssuesByLabel(
  client: GitHubClientPool,
  owner: string,
  repo: string,
  label: string,
) {
  const issues = await paginate<IssueSummary>((page) =>
    client
      .restOptional<IssueSummary[]>(
        {
          path: `/repos/${owner}/${repo}/issues`,
          query: {
            state: "open",
            labels: label,
            per_page: 100,
            page,
          },
        },
        [404, 410],
      )
      .then((issuesPage) => issuesPage ?? []),
  );

  return issues.filter((issue) => !issue.pull_request).length;
}

async function fetchCommunityProfile(client: GitHubClientPool, owner: string, repo: string) {
  return client.restOptional<CommunityProfile>(
    {
      path: `/repos/${owner}/${repo}/community/profile`,
    },
    [404],
  );
}

async function fetchStandardFilePath(
  client: GitHubClientPool,
  owner: string,
  repo: string,
  candidates: string[],
) {
  for (const filePath of candidates) {
    const file = await client.restOptional<ContentFile>(
      {
        path: `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath).replace(/%2F/g, "/")}`,
      },
      [404],
    );

    if (file?.type === "file") {
      return file.path ?? filePath;
    }
  }

  return null;
}

async function fetchRecentRepoPullRequests(
  client: GitHubClientPool,
  owner: string,
  repo: string,
  cutoffDate: Date,
) {
  const pulls = await paginate<PullRequestSummary>(
    (page) =>
      client.rest<PullRequestSummary[]>({
        path: `/repos/${owner}/${repo}/pulls`,
        query: {
          state: "all",
          sort: "created",
          direction: "desc",
          per_page: 100,
          page,
        },
      }),
    (pageItems) => {
      if (pageItems.length === 0) {
        return false;
      }

      const oldest = new Date(pageItems[pageItems.length - 1].created_at);
      return oldest >= cutoffDate;
    },
  );

  return pulls.filter((pull) => new Date(pull.created_at) >= cutoffDate);
}

async function fetchUpdatedRepoPullRequests(
  client: GitHubClientPool,
  owner: string,
  repo: string,
  since: Date,
) {
  const pulls = await paginate<PullRequestSummary>(
    (page) =>
      client.rest<PullRequestSummary[]>({
        path: `/repos/${owner}/${repo}/pulls`,
        query: {
          state: "all",
          sort: "updated",
          direction: "desc",
          per_page: 100,
          page,
        },
      }),
    (pageItems) => {
      if (pageItems.length === 0) {
        return false;
      }

      const oldest = new Date(pageItems[pageItems.length - 1].updated_at);
      return oldest >= since;
    },
  );

  return pulls.filter((pull) => new Date(pull.updated_at) >= since);
}

async function fetchPullRequestReviews(
  client: GitHubClientPool,
  owner: string,
  repo: string,
  number: number,
) {
  return client.rest<PullRequestReview[]>({
    path: `/repos/${owner}/${repo}/pulls/${number}/reviews`,
    query: {
      per_page: 100,
    },
  });
}

export async function analyzeOrganization(input: string): Promise<AnalyzeRepoResponse> {
  const target = parseTarget(input);
  const tokens = [process.env.GITHUB_TOKEN_1, process.env.GITHUB_TOKEN_2].filter(
    (token): token is string => Boolean(token?.trim()),
  );
  const client = new GitHubClientPool(tokens);
  const generatedAt = new Date();
  const cutoffDate = new Date(generatedAt);
  cutoffDate.setDate(cutoffDate.getDate() - ANALYSIS_WINDOW_DAYS);
  const runtimeNotes: string[] = [];

  const snapshotStoreEnabled = isSnapshotStoreConfigured();
  if (snapshotStoreEnabled) {
    await ensureSnapshotTable();
  } else {
    runtimeNotes.push("Neon snapshot storage is disabled because DATABASE_URL is not configured.");
  }

  const latestSnapshotRecord = snapshotStoreEnabled
    ? await loadLatestSnapshot(target.owner, target.repo)
    : null;
  const cachedSnapshot = parseCachedSnapshot(latestSnapshotRecord);
  const cachedGeneratedAt =
    cachedSnapshot?.payload.snapshot.generatedAt
      ? new Date(cachedSnapshot.payload.snapshot.generatedAt)
      : null;
  const canIncrementallyRefresh =
    Boolean(cachedGeneratedAt) && !Number.isNaN(cachedGeneratedAt?.getTime() ?? Number.NaN);

  const repo = await fetchSingleRepo(client, target.owner, target.repo);
  const ownerType = repo.owner.type;

  const publicMembers =
    ownerType === "Organization"
      ? await runStage(
          "Public org member collection",
          () => fetchPublicOrgMembers(client, target.owner),
          cachedSnapshot?.raw.publicMembers ?? [],
          runtimeNotes,
        )
      : [];

  const observedOrgMembers = new Set(publicMembers.map((member) => member.login.toLowerCase()));

  const repoContributors = await runStage(
    "Contributor collection",
    () => fetchRepoContributors(client, target.owner, target.repo),
    cachedSnapshot?.raw.repoContributors ?? [],
    runtimeNotes,
  );

  const repoPullCounts = await runStage(
    "PR total collection",
    () => fetchRepoPullRequestCounts(client, target.owner, target.repo),
    cachedSnapshot?.raw.repoPullCounts ?? { opened: 0, merged: 0, closed: 0 },
    runtimeNotes,
  );

  const cachedPulls = (cachedSnapshot?.raw.recentPullRequests ?? []).filter(
    (pull) => new Date(pull.created_at) >= cutoffDate,
  );
  const refreshedPulls = await runStage(
    "Recent PR collection",
    () =>
      canIncrementallyRefresh && cachedGeneratedAt
        ? fetchUpdatedRepoPullRequests(client, target.owner, target.repo, cachedGeneratedAt)
        : fetchRecentRepoPullRequests(client, target.owner, target.repo, cutoffDate),
    [] as PullRequestSummary[],
    runtimeNotes,
  );

  const changedPullNumbers = new Set(refreshedPulls.map((pull) => pull.number));
  const pullLookup = new Map<number, PullRequestSummary>();
  for (const pull of cachedPulls) {
    pullLookup.set(pull.number, pull);
  }
  for (const pull of refreshedPulls) {
    pullLookup.set(pull.number, pull);
  }

  const recentPulls = [...pullLookup.values()]
    .filter((pull) => new Date(pull.created_at) >= cutoffDate)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));

  const cachedReviewLookup = new Map<number, PullRequestReview[]>();
  for (const entry of cachedSnapshot?.raw.pullRequestReviews ?? []) {
    cachedReviewLookup.set(entry.number, entry.reviews);
  }

  const externalPulls = recentPulls.filter((pull) => isExternalAssociation(pull.author_association));
  const pullsNeedingReviewRefresh = externalPulls.filter(
    (pull) => changedPullNumbers.has(pull.number) || !cachedReviewLookup.has(pull.number),
  );
  const refreshedReviews = await runStage(
    "PR review collection",
    () =>
      mapWithConcurrency(
        pullsNeedingReviewRefresh,
        Math.max(client.tokenCount, 1),
        async (pull) => ({
          number: pull.number,
          reviews: await fetchPullRequestReviews(client, target.owner, target.repo, pull.number),
        }),
      ),
    [] as Array<{ number: number; reviews: PullRequestReview[] }>,
    runtimeNotes,
  );

  const reviewLookup = new Map<number, PullRequestReview[]>();
  for (const pull of externalPulls) {
    const refreshed = refreshedReviews.find((entry) => entry.number === pull.number);
    if (refreshed) {
      reviewLookup.set(pull.number, refreshed.reviews);
      continue;
    }

    if (cachedReviewLookup.has(pull.number)) {
      reviewLookup.set(pull.number, cachedReviewLookup.get(pull.number) ?? []);
    }
  }

  const contributorReadiness = await runStage(
    "Contributor on-ramp collection",
    async () => {
      const [labels, communityProfile, maintainerGuidePath] = await Promise.all([
        fetchRepoLabels(client, target.owner, target.repo),
        fetchCommunityProfile(client, target.owner, target.repo),
        fetchStandardFilePath(client, target.owner, target.repo, MAINTAINER_GUIDE_CANDIDATES),
      ]);
      const matchedLabel = labels.find((label) => isGoodFirstIssueLabel(label.name))?.name ?? null;
      const openGoodFirstIssues = matchedLabel
        ? await fetchOpenIssuesByLabel(client, target.owner, target.repo, matchedLabel)
        : 0;
      const contributingGuidePath =
        communityProfile?.files?.contributing?.path ??
        (await fetchStandardFilePath(client, target.owner, target.repo, CONTRIBUTING_GUIDE_CANDIDATES));

      return {
        repo: repo.name,
        goodFirstIssueLabel: matchedLabel,
        openGoodFirstIssues,
        hasContributingGuide: Boolean(contributingGuidePath),
        contributingGuidePath,
        hasMaintainerGuide: Boolean(maintainerGuidePath),
        maintainerGuidePath,
      } satisfies RepoReadinessSummary;
    },
    cachedSnapshot?.raw.contributorReadiness ?? {
      repo: repo.name,
      goodFirstIssueLabel: null,
      openGoodFirstIssues: 0,
      hasContributingGuide: false,
      contributingGuidePath: null,
      hasMaintainerGuide: false,
      maintainerGuidePath: null,
    },
    runtimeNotes,
  );

  const contributorLogins = new Set<string>();
  for (const contributor of repoContributors) {
    if (contributor.login) {
      contributorLogins.add(contributor.login.toLowerCase());
    }
  }

  const maintainers = new Set<string>();
  const externalContributors = new Set<string>();
  const externalPullCounts = new Map<string, number>();
  const firstReviewLatencies: number[] = [];
  const mergeLatencies: number[] = [];

  for (const pull of recentPulls) {
    const login = pull.user?.login?.toLowerCase();
    const association = pull.author_association;

    if (login) {
      if (isMaintainerAssociation(association)) {
        maintainers.add(login);
      }

      if (isObservedOrgMemberAssociation(association)) {
        observedOrgMembers.add(login);
      }

      if (isExternalAssociation(association)) {
        externalContributors.add(login);
        externalPullCounts.set(login, (externalPullCounts.get(login) ?? 0) + 1);
      }
    }

    if (login && isExternalAssociation(association)) {
      const reviews = (reviewLookup.get(pull.number) ?? [])
        .filter((review) => Boolean(review.submitted_at))
        .sort((left, right) => (left.submitted_at ?? "").localeCompare(right.submitted_at ?? ""));
      const firstReview = reviews[0];

      if (firstReview?.submitted_at) {
        const reviewHours =
          (new Date(firstReview.submitted_at).getTime() - new Date(pull.created_at).getTime()) /
          3_600_000;
        if (reviewHours >= 0) {
          firstReviewLatencies.push(reviewHours);
        }
      }

      if (pull.merged_at) {
        const mergeHours =
          (new Date(pull.merged_at).getTime() - new Date(pull.created_at).getTime()) / 3_600_000;
        if (mergeHours >= 0) {
          mergeLatencies.push(mergeHours);
        }
      }
    }
  }

  for (const login of observedOrgMembers) {
    externalContributors.delete(login);
  }

  for (const login of maintainers) {
    externalContributors.delete(login);
  }

  const notes = [
    "The product is now repo-only. Organization-wide scans are intentionally disabled.",
    "Contributor experience metrics are calculated from external-contributor PRs opened in the last 90 days.",
    "Maintainer count is inferred from public PR author associations marked COLLABORATOR or OWNER.",
    "Org member count uses public org membership when available and is supplemented by recent PR authors marked MEMBER or OWNER.",
    "Contributor on-ramp checks look for CONTRIBUTING.md, maintainer-guide style markdown, and a good first issue label.",
    canIncrementallyRefresh
      ? `Incremental refresh reused cached PR history from ${cachedSnapshot?.payload.snapshot.generatedAt}.`
      : "If no prior cached PR history is available, the query pulls the full 90-day window. This may take up to 10 minutes for large repos.",
    ...runtimeNotes,
  ];

  const response: AnalyzeRepoResponse = {
    target: {
      owner: target.owner,
      repo: target.repo,
      slug: target.slug,
    },
    repository: {
      name: repo.name,
      fullName: repo.full_name,
      htmlUrl: repo.html_url,
      defaultBranch: repo.default_branch,
      archived: repo.archived,
      ownerType,
    },
    snapshot: {
      generatedAt: generatedAt.toISOString(),
      cacheHit: Boolean(cachedSnapshot),
      baseSnapshotGeneratedAt: cachedSnapshot?.payload.snapshot.generatedAt ?? null,
      tokensUsed: Math.max(client.tokenCount, 1),
      notes,
    },
    metrics: {
      vanity: {
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        orgMembers: observedOrgMembers.size,
        contributors: contributorLogins.size,
      },
      pullRequests: {
        totalLast90Days: recentPulls.length,
        opened: repoPullCounts.opened + repoPullCounts.merged + repoPullCounts.closed,
        merged: repoPullCounts.merged,
        closed: repoPullCounts.closed,
      },
      contributorExperience: {
        maintainers: maintainers.size,
        externalContributors: externalContributors.size,
        repeatContributors: [...externalPullCounts.values()].filter((count) => count > 1).length,
        averageHoursToFirstReview: average(firstReviewLatencies),
        averageHoursToMerge: average(mergeLatencies),
      },
      contributorOnRamp: {
        hasContributingGuide: contributorReadiness.hasContributingGuide,
        contributingGuidePath: contributorReadiness.contributingGuidePath,
        hasMaintainerGuide: contributorReadiness.hasMaintainerGuide,
        maintainerGuidePath: contributorReadiness.maintainerGuidePath,
        goodFirstIssueLabel: contributorReadiness.goodFirstIssueLabel,
        openGoodFirstIssues: contributorReadiness.openGoodFirstIssues,
      },
    },
    analysis: {
      window: {
        start: cutoffDate.toISOString(),
        end: generatedAt.toISOString(),
        label: "Last 90 days",
      },
      cache: {
        reusedPullRequests: Math.max(cachedPulls.length - changedPullNumbers.size, 0),
        refreshedPullRequests: refreshedPulls.length,
        reusedReviews: Math.max(externalPulls.length - pullsNeedingReviewRefresh.length, 0),
        refreshedReviews: refreshedReviews.length,
      },
    },
    comparison: {
      previousSnapshotGeneratedAt: cachedSnapshot?.payload.snapshot.generatedAt ?? null,
      metrics: [],
    },
  };

  response.comparison.metrics = buildMetricChanges(cachedSnapshot?.payload, response);

  await saveSnapshot(target.owner, target.repo, response.snapshot.generatedAt, response, {
    publicMembers,
    repoContributors,
    repoPullCounts,
    recentPullRequests: recentPulls,
    pullRequestReviews: [...reviewLookup.entries()].map(([number, reviews]) => ({ number, reviews })),
    contributorReadiness,
  });

  return response;
}
